// CR 卡牌 API 代理 —— Netlify Functions 版
// 为什么走 RoyaleAPI 代理：Supercell token 严格绑定白名单 IP，Netlify 出口 IP 是动态池（永远 403）。
// 故本 Function 把请求转发给 RoyaleAPI 社区代理（proxy.royaleapi.dev，出口固定 IP 45.79.218.79），
// 由它把你的 Supercell token 原样转发给官方 API。你建 token 时白名单 IP 填 45.79.218.79 即可。
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

// 把官方卡牌对象精简成 App 需要的字段（官方用 elixirCost，App 用 elixir）
function simplify(c) {
  return {
    id: c.id,
    name: c.name || null,
    elixir: (c.elixirCost != null ? c.elixirCost : null),
    rarity: c.rarity || null,
    type: c.type || null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const TOKEN = process.env.CR_API_TOKEN;
  const PROXY = (process.env.CR_PROXY_URL || 'https://proxy.royaleapi.dev/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${PROXY}/cards`, {
      headers: { Authorization: `Bearer ${TOKEN || ''}` }
    });
    const raw = await res.text();
    if (!res.ok) {
      // 把官方的错误（如 403 token 未白名单）原样返回，方便排查
      return { statusCode: res.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: raw };
    }
    const json = JSON.parse(raw);
    const rawItems = Array.isArray(json) ? json : (json.items || []);
    const dbg = event.queryStringParameters && event.queryStringParameters.debug;
    if (dbg) {
      const sample = rawItems[0] || {};
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ count: rawItems.length, keys: Object.keys(sample), sample }) };
    }
    const items = rawItems.map(simplify);
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
