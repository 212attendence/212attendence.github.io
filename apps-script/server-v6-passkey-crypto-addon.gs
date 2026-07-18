function v6CborRead_(bytes, start) {
  var offset = start || 0;
  if (offset >= bytes.length) throw v6Error_('CBOR_EOF', '패스키 CBOR 데이터가 끝났습니다.');
  var initial = bytes[offset++] & 255;
  var major = initial >> 5;
  var additional = initial & 31;
  var lengthInfo = v6CborLength_(bytes, offset, additional);
  var length = lengthInfo.value;
  offset = lengthInfo.offset;
  if (major === 0) return { value: length, offset: offset };
  if (major === 1) return { value: -1 - length, offset: offset };
  if (major === 2) return { value: bytes.slice(offset, offset + length), offset: offset + length };
  if (major === 3) return { value: v6BytesToUtf8_(bytes.slice(offset, offset + length)), offset: offset + length };
  if (major === 4) {
    var array = [];
    for (var i = 0; i < length; i++) { var item = v6CborRead_(bytes, offset); array.push(item.value); offset = item.offset; }
    return { value: array, offset: offset };
  }
  if (major === 5) {
    var map = {};
    for (var m = 0; m < length; m++) {
      var keyItem = v6CborRead_(bytes, offset); offset = keyItem.offset;
      var valueItem = v6CborRead_(bytes, offset); offset = valueItem.offset;
      map[String(keyItem.value)] = valueItem.value;
    }
    return { value: map, offset: offset };
  }
  if (major === 6) return v6CborRead_(bytes, offset);
  if (major === 7) {
    if (additional === 20) return { value: false, offset: offset };
    if (additional === 21) return { value: true, offset: offset };
    if (additional === 22 || additional === 23) return { value: null, offset: offset };
  }
  throw v6Error_('CBOR_UNSUPPORTED', '지원하지 않는 패스키 CBOR 형식입니다.');
}

function v6CborLength_(bytes, offset, additional) {
  if (additional < 24) return { value: additional, offset: offset };
  if (additional === 24) return { value: bytes[offset] & 255, offset: offset + 1 };
  if (additional === 25) return { value: ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255), offset: offset + 2 };
  if (additional === 26) return { value: v6ReadUint32_(bytes, offset), offset: offset + 4 };
  throw v6Error_('CBOR_LENGTH_UNSUPPORTED', '너무 큰 패스키 CBOR 길이는 지원하지 않습니다.');
}

function v6VerifyEcdsaP256_(data, derSignature, xBytes, yBytes) {
  if (typeof BigInt !== 'function') throw v6Error_('BIGINT_REQUIRED', 'Apps Script V8 런타임을 사용해야 패스키를 검증할 수 있습니다.');
  var signature = v6ParseDerSignature_(derSignature);
  var curve = v6P256_();
  if (signature.r <= 0 || signature.r >= curve.n || signature.s <= 0 || signature.s >= curve.n) return false;
  var q = { x: v6BytesToBigInt_(xBytes), y: v6BytesToBigInt_(yBytes), z: BigInt(1) };
  if (!v6PointValid_(q, curve)) return false;
  var z = v6BytesToBigInt_(v6Sha256_(data)) % curve.n;
  var w = v6ModInverse_(signature.s, curve.n);
  var u1 = v6Mod_(z * w, curve.n);
  var u2 = v6Mod_(signature.r * w, curve.n);
  var g = { x: curve.gx, y: curve.gy, z: BigInt(1) };
  var point = v6PointAdd_(v6PointMultiply_(g, u1, curve), v6PointMultiply_(q, u2, curve), curve);
  if (point.z === BigInt(0)) return false;
  var affine = v6ToAffine_(point, curve);
  return v6Mod_(affine.x, curve.n) === signature.r;
}

function v6P256_() {
  var p = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  return {
    p: p,
    a: p - BigInt(3),
    b: BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B'),
    n: BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551'),
    gx: BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296'),
    gy: BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5')
  };
}

function v6PointValid_(point, curve) {
  if (point.x < 0 || point.x >= curve.p || point.y < 0 || point.y >= curve.p) return false;
  return v6Mod_(point.y * point.y - (point.x * point.x * point.x + curve.a * point.x + curve.b), curve.p) === BigInt(0);
}

function v6PointMultiply_(point, scalar, curve) {
  var result = { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var addend = point;
  var k = scalar;
  while (k > 0) {
    if ((k & BigInt(1)) === BigInt(1)) result = v6PointAdd_(result, addend, curve);
    addend = v6PointDouble_(addend, curve);
    k >>= BigInt(1);
  }
  return result;
}

function v6PointDouble_(point, curve) {
  if (point.z === BigInt(0) || point.y === BigInt(0)) return { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var p = curve.p;
  var xx = v6Mod_(point.x * point.x, p);
  var yy = v6Mod_(point.y * point.y, p);
  var yyyy = v6Mod_(yy * yy, p);
  var zz = v6Mod_(point.z * point.z, p);
  var s = v6Mod_(BigInt(2) * (v6Mod_((point.x + yy) * (point.x + yy), p) - xx - yyyy), p);
  var m = v6Mod_(BigInt(3) * xx + curve.a * v6Mod_(zz * zz, p), p);
  var x3 = v6Mod_(m * m - BigInt(2) * s, p);
  var y3 = v6Mod_(m * (s - x3) - BigInt(8) * yyyy, p);
  var z3 = v6Mod_(BigInt(2) * point.y * point.z, p);
  return { x: x3, y: y3, z: z3 };
}

function v6PointAdd_(p1, p2, curve) {
  if (p1.z === BigInt(0)) return p2;
  if (p2.z === BigInt(0)) return p1;
  var p = curve.p;
  var z1z1 = v6Mod_(p1.z * p1.z, p);
  var z2z2 = v6Mod_(p2.z * p2.z, p);
  var u1 = v6Mod_(p1.x * z2z2, p);
  var u2 = v6Mod_(p2.x * z1z1, p);
  var s1 = v6Mod_(p1.y * p2.z * z2z2, p);
  var s2 = v6Mod_(p2.y * p1.z * z1z1, p);
  if (u1 === u2) return s1 === s2 ? v6PointDouble_(p1, curve) : { x: BigInt(0), y: BigInt(1), z: BigInt(0) };
  var h = v6Mod_(u2 - u1, p);
  var i = v6Mod_((BigInt(2) * h) * (BigInt(2) * h), p);
  var j = v6Mod_(h * i, p);
  var r = v6Mod_(BigInt(2) * (s2 - s1), p);
  var v = v6Mod_(u1 * i, p);
  var x3 = v6Mod_(r * r - j - BigInt(2) * v, p);
  var y3 = v6Mod_(r * (v - x3) - BigInt(2) * s1 * j, p);
  var z3 = v6Mod_(((p1.z + p2.z) * (p1.z + p2.z) - z1z1 - z2z2) * h, p);
  return { x: x3, y: y3, z: z3 };
}

function v6ToAffine_(point, curve) {
  var zInv = v6ModInverse_(point.z, curve.p);
  var z2 = v6Mod_(zInv * zInv, curve.p);
  return { x: v6Mod_(point.x * z2, curve.p), y: v6Mod_(point.y * z2 * zInv, curve.p) };
}

function v6ModInverse_(value, modulus) {
  var a = v6Mod_(value, modulus);
  var b = modulus;
  var x0 = BigInt(1), x1 = BigInt(0);
  while (b !== BigInt(0)) {
    var q = a / b;
    var t = a % b; a = b; b = t;
    t = x0 - q * x1; x0 = x1; x1 = t;
  }
  return v6Mod_(x0, modulus);
}

function v6Mod_(value, modulus) { var result = value % modulus; return result < 0 ? result + modulus : result; }

function v6ParseDerSignature_(bytes) {
  var offset = 0;
  if ((bytes[offset++] & 255) !== 48) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 형식이 올바르지 않습니다.');
  var sequenceLength = v6DerLength_(bytes, offset); offset = sequenceLength.offset;
  if ((bytes[offset++] & 255) !== 2) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 R 값이 없습니다.');
  var rLength = v6DerLength_(bytes, offset); offset = rLength.offset;
  var rBytes = bytes.slice(offset, offset + rLength.value); offset += rLength.value;
  if ((bytes[offset++] & 255) !== 2) throw v6Error_('PASSKEY_SIGNATURE_FORMAT', '패스키 서명 S 값이 없습니다.');
  var sLength = v6DerLength_(bytes, offset); offset = sLength.offset;
  var sBytes = bytes.slice(offset, offset + sLength.value);
  while (rBytes.length > 1 && rBytes[0] === 0) rBytes.shift();
  while (sBytes.length > 1 && sBytes[0] === 0) sBytes.shift();
  return { r: v6BytesToBigInt_(rBytes), s: v6BytesToBigInt_(sBytes) };
}

function v6DerLength_(bytes, offset) {
  var first = bytes[offset++] & 255;
  if (first < 128) return { value: first, offset: offset };
  var count = first & 127;
  var value = 0;
  for (var i = 0; i < count; i++) value = value * 256 + (bytes[offset++] & 255);
  return { value: value, offset: offset };
}

function v6BytesToBigInt_(bytes) {
  if (!bytes || !bytes.length) return BigInt(0);
  var hex = bytes.map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  return BigInt('0x' + hex);
}

function v6RandomToken_(length) {
  var material = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + Date.now() + '|' + Math.random();
  var bytes = v6Sha256_(v6Utf8Bytes_(material));
  var token = v6B64Encode_(bytes);
  while (token.length < length) token += v6B64Encode_(v6Sha256_(v6Utf8Bytes_(token + material)));
  return token.slice(0, length);
}

function v6B64Decode_(value) {
  var text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  try { return Utilities.base64Decode(text).map(function (byte) { return byte & 255; }); }
  catch (error) { throw v6Error_('BASE64_INVALID', '패스키 인코딩을 읽지 못했습니다.'); }
}

function v6B64Encode_(bytes) {
  return Utilities.base64EncodeWebSafe(v6SignedBytes_(bytes)).replace(/=+$/g, '');
}

function v6Utf8Bytes_(text) {
  return Utilities.newBlob(String(text || '')).getBytes().map(function (byte) { return byte & 255; });
}

function v6BytesToUtf8_(bytes) {
  return Utilities.newBlob(v6SignedBytes_(bytes)).getDataAsString('UTF-8');
}

function v6Sha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v6SignedBytes_(bytes)).map(function (byte) { return byte & 255; });
}

function v6SignedBytes_(bytes) {
  return (bytes || []).map(function (byte) { var value = byte & 255; return value > 127 ? value - 256 : value; });
}

function v6BytesEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) mismatch |= (a[i] & 255) ^ (b[i] & 255);
  return mismatch === 0;
}

function v6ReadUint32_(bytes, offset) {
  return ((bytes[offset] & 255) * 16777216) + ((bytes[offset + 1] & 255) << 16) + ((bytes[offset + 2] & 255) << 8) + (bytes[offset + 3] & 255);
}

function v6ParseJson_(value, message) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch (error) { throw v6Error_('JSON_INVALID', message || 'JSON 형식이 올바르지 않습니다.'); }
}

function v6Error_(code, message) { var error = new Error(message); error.code = code; return error; }
