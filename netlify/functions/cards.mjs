// CR 卡牌 API 代理 —— Netlify Functions 版
// 为什么走 RoyaleAPI 代理：Supercell token 严格绑定白名单 IP，Netlify 出口 IP 是动态池（永远 403）。
// 故本 Function 把请求转发给 RoyaleAPI 社区代理（proxy.royaleapi.dev，出口固定 IP 45.79.218.79），
// 由它把你的 Supercell token 原样转发给官方 API。你建 token 时白名单 IP 填 45.79.218.79 即可。
//
// 只依赖官方 API（api.clashroyale.com，经 RoyaleAPI 代理），不依赖任何第三方卡表：
//   - id / name / elixir / rarity : 官方 API 原样字段（elixirCost → elixir）
//   - evolution / hero            : 官方 API 的 iconUrls 字段——有 evolutionMedium 即「可进化」，有 heroMedium 即「英雄卡」
//   - icon / icon_evo / icon_hero : 官方图床 URL（medium / evolutionMedium / heroMedium），App 直接用官方图
//   - is_tower                    : 官方 /v1/cards 不含塔兵（Tower Princess 等仅出现在本地库），故恒为 false
//   - type (troop/building/spell) : 官方 API 不返回；App 侧新增卡默认填 "troop"，由用户手动维护，本函数不再提供
//
// 接口：GET /.netlify/functions/cards        -> 全量卡牌（数组）
//       GET /.netlify/functions/cards?id=26000000 -> 单卡
//       GET /.netlify/functions/cards?raw=1  -> 原样返回官方上游数据（调试用）
// 部署：把 cr-api-proxy/ 推到 GitHub，Netlify 导入，设环境变量 CR_API_TOKEN=<你的token>。
//       （可选）CR_PROXY_URL 默认 https://proxy.royaleapi.dev/v1

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

// 把官方卡牌对象精简成 App 需要的字段。
// 注意：evolution/hero 直接由官方 iconUrls 推断（evolutionMedium/heroMedium 字段存在与否）。
// type 不返回（官方无此字段），App 新增卡默认 troop、用户手动维护。
function simplify(c) {
  const iu = c.iconUrls || {};
  return {
    id: c.id,
    name: c.name || null,
    elixir: (c.elixirCost != null ? c.elixirCost : null),
    rarity: c.rarity || null,
    evolution: !!iu.evolutionMedium,
    hero: !!iu.heroMedium,
    is_tower: false,
    icon: iu.medium || null,
    icon_evo: iu.evolutionMedium || null,
    icon_hero: iu.heroMedium || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const TOKEN = process.env.CR_API_TOKEN;
  const PROXY = (process.env.CR_PROXY_URL || 'https://proxy.royaleapi.dev/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${PROXY}/cards`, { headers: { Authorization: `Bearer ${TOKEN || ''}` } });
    const raw = await res.text();
    if (!res.ok) {
      // 把官方的错误（如 403 token 未白名单）原样返回，方便排查
      return { statusCode: res.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: raw };
    }
    const json = JSON.parse(raw);
    const rawItems = Array.isArray(json) ? json : (json.items || []);
    // 调试用：?raw=1 原样返回官方上游数据（未经精简），方便核对官方到底有哪些字段
    if (event.queryStringParameters && event.queryStringParameters.raw === '1') {
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(rawItems) };
    }
    const items = rawItems.map((c) => simplify(c));
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (id) {
      const num = parseInt(id, 10);
      const one = items.find((c) => c.id === num);
      if (!one) {
        return { statusCode: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `card not found: ${id}` }) };
      }
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }, body: JSON.stringify(one) };
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }, body: JSON.stringify(items) };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e) }) };
  }
};
