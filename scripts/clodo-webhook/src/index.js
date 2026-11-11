// Clodo requires a public HTTPS webhook_url on every async search, but results are fetched by polling
// GET /search/{job_id}/ (free), so deliveries are acknowledged and dropped. Nothing is stored here.
export default {
  async fetch(request) {
    if (request.method === "POST") return new Response(null, { status: 204 });
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  },
};
