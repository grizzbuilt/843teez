const https = require("https");

const KEY = "066e27e04fd842eeb1b8268f8ede0542";
const HOST = "843teez.com";
const SITEMAP_URL = "https://843teez.com/sitemap.xml";

https.get(SITEMAP_URL, (res) => {
  let xml = "";

  res.on("data", chunk => xml += chunk);

  res.on("end", () => {
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);

    console.log(`Found ${urls.length} URLs`);

    const payload = JSON.stringify({
      host: HOST,
      key: KEY,
      urlList: urls
    });

    const req = https.request({
      hostname: "api.indexnow.org",
      path: "/indexnow",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      console.log("IndexNow Status:", res.statusCode);
    });

    req.on("error", err => console.error("Error:", err.message));

    req.write(payload);
    req.end();
  });
});
