import test from "node:test";
import assert from "node:assert/strict";
import { generateVapidKeys, resolveVapidPrivate, encryptPayload, _test } from "../scripts/webpush.mjs";

test("generateVapidKeys i resolveVapidPrivate: poprawna para i różne formaty sekretu", () => {
  const pair = generateVapidKeys();
  assert.equal(_test.unb64u(pair.publicKey).length, 65);
  assert.equal(_test.unb64u(pair.privateKey).length, 32);

  // Czysty klucz
  assert.equal(resolveVapidPrivate(pair.privateKey, pair.publicKey), pair.privateKey);
  // Z prefiksem i cudzysłowami (np. przypadkowo wklejone z .env)
  assert.equal(resolveVapidPrivate('VAPID_PRIVATE_KEY="' + pair.privateKey + '"\n', pair.publicKey), pair.privateKey);
  // Format JSON JWK
  assert.equal(resolveVapidPrivate(JSON.stringify({ d: pair.privateKey }), pair.publicKey), pair.privateKey);

  // Błędny klucz (np. wklejony publiczny zamiast prywatnego)
  assert.throws(() => resolveVapidPrivate(pair.publicKey, pair.publicKey), /PUBLICZNY/);
});

test("encryptPayload: szyfrowanie zgodne z wektorem testowym RFC 8291 (sekcja 5)", () => {
  // Oficjalny wektor testowy z RFC 8291 Section 5
  const sub = {
    keys: {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
  };
  const fixed = {
    asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
  };
  const plaintext = "When I grow up, I want to be a watermelon";
  const expectedB64u =
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  const out = encryptPayload(sub, plaintext, fixed);
  assert.equal(_test.b64u(out), expectedB64u);
});

test("vapidJwt: poprawna struktura JWT ES256", () => {
  const pair = generateVapidKeys();
  const jwt = _test.vapidJwt(
    "https://updates.push.services.mozilla.com/wpush/v2/test",
    "https://sajm-n.github.io/itplanzajec/",
    pair.publicKey,
    pair.privateKey,
    1700000000000
  );
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(_test.unb64u(parts[0]).toString("utf8"));
  const payload = JSON.parse(_test.unb64u(parts[1]).toString("utf8"));
  assert.equal(header.alg, "ES256");
  assert.equal(payload.aud, "https://updates.push.services.mozilla.com");
  assert.equal(payload.sub, "https://sajm-n.github.io/itplanzajec/");
});
