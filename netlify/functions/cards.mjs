// CR 卡牌 API 代理 —— Netlify Functions 版
// 为什么走 RoyaleAPI 代理：Supercell token 严格绑定白名单 IP，Netlify 出口 IP 是动态池（永远 403）。
// 故本 Function 把请求转发给 RoyaleAPI 社区代理（proxy.royaleapi.dev，出口固定 IP 45.79.218.79），
// 由它把你的 Supercell token 原样转发给官方 API。你建 token 时白名单 IP 填 45.79.218.79 即可。
//
// 字段来源：
//   - elixir / rarity / name / id : 官方 API（api.clashroyale.com，经 RoyaleAPI 代理）
//   - type (troop/spell/building): 官方 API 不返回 type，改从 ClashStrategic/stats 按 id 合入
//
// 接口：GET /.netlify/functions/cards        -> 全量卡牌（数组）
//       GET /.netlify/functions/cards?id=26000000 -> 单卡
// 部署：把 cr-api-proxy/ 推到 GitHub，Netlify 导入，设环境变量 CR_API_TOKEN=<你的token>。
//       （可选）CR_PROXY_URL 默认 https://proxy.royaleapi.dev/v1

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

// 官方 API 不返回 type，这里用 ClashStrategic 的静态卡表按 id 补 type（troop/spell/building）
const TYPE_SRC = 'https://cdn.jsdelivr.net/gh/ClashStrategic/stats/data/cards.json';

async function fetchTypeMap() {
  try {
    const res = await fetch(TYPE_SRC);
    if (!res.ok) return {};
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json.cards || []);
    const map = {};
    for (const c of arr) {
      if (c && c.id != null && c.type) map[c.id] = c.type;
    }
    return map;
  } catch (e) {
    return {};
  }
}

// 把官方卡牌对象精简成 App 需要的字段（官方用 elixirCost，App 用 elixir；type 来自 ClashStrategic）
function simplify(c, typeMap) {
  return {
    id: c.id,
    name: c.name || null,
    elixir: (c.elixirCost != null ? c.elixirCost : null),
    rarity: c.rarity || null,
    type: (typeMap && typeMap[c.id]) || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const TOKEN = process.env.CR_API_TOKEN;
  const PROXY = (process.env.CR_PROXY_URL || 'https://proxy.royaleapi.dev/v1').replace(/\/$/, '');
  try {
    const [res, typeMap] = await Promise.all([
      fetch(`${PROXY}/cards`, { headers: { Authorization: `Bearer ${TOKEN || ''}` } }),
      fetchTypeMap()
    ]);
    const raw = await res.text();
    if (!res.ok) {
      // 把官方的错误（如 403 token 未白名单）原样返回，方便排查
      return { statusCode: res.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: raw };
    }
    const json = JSON.parse(raw);
    const rawItems = Array.isArray(json) ? json : (json.items || []);
    const items = rawItems.map((c) => simplify(c, typeMap));
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
