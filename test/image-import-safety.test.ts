import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeExternalImageUrl,
  readResponseBytes,
} from "../src/modules/markdown/images/service.ts";

test("allows public http(s) image URLs", () => {
  assert.equal(isSafeExternalImageUrl("https://example.com/a.png"), true);
  assert.equal(isSafeExternalImageUrl("http://example.com/a.png"), true);
  assert.equal(isSafeExternalImageUrl("https://cdn.example.org/x?y=1"), true);
  assert.equal(
    isSafeExternalImageUrl("https://sub.domain.com:8443/a.png"),
    true,
  );
});

test("rejects non-http(s) schemes and malformed URLs", () => {
  assert.equal(isSafeExternalImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalImageUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalImageUrl("data:image/png;base64,xx"), false);
  assert.equal(isSafeExternalImageUrl("ftp://example.com/a.png"), false);
  assert.equal(isSafeExternalImageUrl("not a url"), false);
  assert.equal(isSafeExternalImageUrl(""), false);
});

test("blocks loopback and private network hosts (SSRF guard)", () => {
  for (const blocked of [
    "http://localhost/a.png",
    "http://localhost:8080/a.png",
    "http://sub.localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://127.0.0.2:3000/a.png",
    "http://10.0.0.1/a.png",
    "http://172.16.0.1/a.png",
    "http://172.31.255.255/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/a.png",
    "http://255.255.255.255/a.png",
    "http://224.0.0.1/a.png",
    "http://[::1]/a.png",
    "http://[0:0:0:0:0:0:0:1]/a.png",
  ]) {
    assert.equal(isSafeExternalImageUrl(blocked), false, blocked);
  }
  // Public IPv4 and IPv6 pass.
  assert.equal(isSafeExternalImageUrl("http://8.8.8.8/a.png"), true);
  assert.equal(
    isSafeExternalImageUrl("http://[2001:4860:4860::8888]/a.png"),
    true,
  );
});

test("bounds streamed external image responses", async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]));
  await assert.rejects(
    readResponseBytes(response, 3),
    /exceeds the maximum allowed size/,
  );
});
