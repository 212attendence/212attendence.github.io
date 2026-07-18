/* --------------------------------------------------------------------------
 * WebAuthn passkey
 * -------------------------------------------------------------------------- */

function v6EnsurePasskeySheet_() {
  return studentEnsureSheet_(studentOpenSpreadsheet_(), ADMIN_COMPAT_PASSKEY_SHEET, ADMIN_COMPAT_PASSKEY_HEADERS);
}

function v6PasskeyRegisterOptions_(params) {
  var auth = adminCompatRequire_(params);
  v6EnsurePasskeySheet_();
  var origin = v6ValidatedOrigin_(params.origin, params.hostname);
  var requestId = v6RandomToken_(24);
  var challenge = v6RandomToken_(32);
  var identity = String(auth.email || auth.adminId || auth.name || 'admin');
  var userId = v6B64Encode_(v6Sha256_(v6Utf8Bytes_(identity)));
  var exclude = studentRows_(adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET)).filter(function (row) {
    return adminCompatTrue_(row.active) && String(row.loginId || '') === identity;
  }).map(function (row) { return { type: 'public-key', id: String(row.credentialId || '') }; }).filter(function (item) { return item.id; });
  CacheService.getScriptCache().put('V6_PK_REG_' + requestId, JSON.stringify({
    challenge: challenge,
    origin: origin,
    rpId: V6_RP_ID,
    identity: identity,
    loginType: auth.loginType || (auth.email ? 'google' : 'admin'),
    loginId: identity,
    displayName: auth.name || identity,
    role: auth.role || 'ADMIN',
    userId: userId,
    createdAt: Date.now()
  }), V6_PASSKEY_REQUEST_TTL_SEC);
  return {
    ok: true,
    requestId: requestId,
    version: V6_SERVER_VERSION,
    publicKey: {
      challenge: challenge,
      rp: { name: V6_RP_NAME, id: V6_RP_ID },
      user: { id: userId, name: identity, displayName: auth.name || identity },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
      excludeCredentials: exclude
    }
  };
}

function v6PasskeyRegisterVerify_(params) {
  var auth = adminCompatRequire_(params);
  var requestId = String(params.requestId || '').trim();
  var raw = CacheService.getScriptCache().get('V6_PK_REG_' + requestId);
  if (!raw) return studentFail_('PASSKEY_REQUEST_EXPIRED', '패스키 등록 요청이 만료되었습니다. 다시 시도하세요.');
  var request = JSON.parse(raw);
  var credential = v6ParseJson_(params.credential, '패스키 등록 응답을 읽지 못했습니다.');
  var clientDataBytes = v6B64Decode_(credential && credential.response && credential.response.clientDataJSON);
  var clientData = v6ParseJson_(v6BytesToUtf8_(clientDataBytes), '패스키 등록 확인값이 올바르지 않습니다.');
  v6CheckClientData_(clientData, 'webauthn.create', request.challenge, request.origin);
  var attestationBytes = v6B64Decode_(credential && credential.response && credential.response.attestationObject);
  var parsed = v6ParseAttestation_(attestationBytes, request.rpId);
  var credentialId = String(credential.id || credential.rawId || v6B64Encode_(parsed.credentialId));
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '패스키 ID가 없습니다.');

  var sheet = v6EnsurePasskeySheet_();
  studentRows_(sheet).forEach(function (row) {
    if (String(row.credentialId || '') === credentialId && adminCompatTrue_(row.active)) {
      studentUpdateRow_(sheet, row._row, { active: false, lastUsedAt: new Date() });
    }
  });
  studentAppendObject_(sheet, ADMIN_COMPAT_PASSKEY_HEADERS, {
    createdAt: new Date(),
    credentialId: credentialId,
    userId: request.userId,
    loginType: request.loginType,
    loginId: request.loginId,
    displayName: request.displayName,
    role: request.role,
    publicKeyX: v6B64Encode_(parsed.x),
    publicKeyY: v6B64Encode_(parsed.y),
    alg: parsed.alg,
    signCount: parsed.signCount,
    deviceName: String(params.deviceName || '').slice(0, 120),
    userAgent: String(params.userAgent || '').slice(0, 180),
    active: true,
    lastUsedAt: new Date()
  });
  CacheService.getScriptCache().remove('V6_PK_REG_' + requestId);
  SpreadsheetApp.flush();
  return { ok: true, credentialId: credentialId, registered: true, version: V6_SERVER_VERSION, name: auth.name || request.displayName };
}

function v6PasskeyLoginOptions_(params) {
  v6EnsurePasskeySheet_();
  var credentialId = String(params.credentialId || '').trim();
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '등록된 패스키 정보가 없습니다.');
  var row = studentRows_(adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET)).filter(function (item) {
    return adminCompatTrue_(item.active) && String(item.credentialId || '') === credentialId;
  })[0] || null;
  if (!row) return studentFail_('PASSKEY_NOT_FOUND', '서버에 등록된 패스키를 찾지 못했습니다. 다른 방법으로 로그인한 뒤 다시 등록하세요.');
  var origin = v6ValidatedOrigin_(params.origin, params.hostname);
  var requestId = v6RandomToken_(24);
  var challenge = v6RandomToken_(32);
  CacheService.getScriptCache().put('V6_PK_LOGIN_' + requestId, JSON.stringify({
    challenge: challenge,
    origin: origin,
    rpId: V6_RP_ID,
    credentialId: credentialId,
    loginType: String(row.loginType || 'passkey'),
    loginId: String(row.loginId || ''),
    displayName: String(row.displayName || row.loginId || '관리자'),
    role: String(row.role || 'ADMIN'),
    publicKeyX: String(row.publicKeyX || ''),
    publicKeyY: String(row.publicKeyY || ''),
    signCount: Number(row.signCount || 0),
    row: row._row,
    createdAt: Date.now()
  }), V6_PASSKEY_REQUEST_TTL_SEC);
  return {
    ok: true,
    requestId: requestId,
    version: V6_SERVER_VERSION,
    publicKey: {
      challenge: challenge,
      timeout: 60000,
      rpId: V6_RP_ID,
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required'
    }
  };
}

function v6PasskeyLoginVerify_(params) {
  var requestId = String(params.requestId || '').trim();
  var cache = CacheService.getScriptCache();
  var raw = cache.get('V6_PK_LOGIN_' + requestId);
  if (!raw) return studentFail_('PASSKEY_REQUEST_EXPIRED', '패스키 로그인 요청이 만료되었습니다. 다시 시도하세요.');
  var request = JSON.parse(raw);
  var credential = v6ParseJson_(params.credential, '패스키 로그인 응답을 읽지 못했습니다.');
  var credentialId = String(credential.id || credential.rawId || '').trim();
  if (!credentialId || credentialId !== request.credentialId) return studentFail_('PASSKEY_CREDENTIAL_MISMATCH', '등록된 패스키와 응답이 일치하지 않습니다.');
  var response = credential.response || {};
  var clientDataBytes = v6B64Decode_(response.clientDataJSON);
  var clientData = v6ParseJson_(v6BytesToUtf8_(clientDataBytes), '패스키 로그인 확인값이 올바르지 않습니다.');
  v6CheckClientData_(clientData, 'webauthn.get', request.challenge, request.origin);
  var authenticatorData = v6B64Decode_(response.authenticatorData);
  var signature = v6B64Decode_(response.signature);
  var auth = v6ParseAuthenticatorData_(authenticatorData, request.rpId, false);
  if ((auth.flags & 1) === 0 || (auth.flags & 4) === 0) return studentFail_('PASSKEY_USER_VERIFICATION_REQUIRED', '기기 사용자 확인이 완료되지 않았습니다.');
  var signedData = authenticatorData.concat(v6Sha256_(clientDataBytes));
  var verified = v6VerifyEcdsaP256_(signedData, signature, v6B64Decode_(request.publicKeyX), v6B64Decode_(request.publicKeyY));
  if (!verified) return studentFail_('PASSKEY_SIGNATURE_INVALID', '패스키 서명을 확인하지 못했습니다.');
  if (request.signCount > 0 && auth.signCount > 0 && auth.signCount <= request.signCount) {
    return studentFail_('PASSKEY_COUNTER_REPLAY', '패스키 사용 횟수 검증에 실패했습니다. 패스키를 다시 등록하세요.');
  }
  var sheet = adminCompatSheet_(ADMIN_COMPAT_PASSKEY_SHEET);
  if (request.row) studentUpdateRow_(sheet, Number(request.row), { signCount: auth.signCount, lastUsedAt: new Date(), active: true });
  var session = adminCompatCreateSession_({
    loginType: 'passkey',
    adminId: request.loginType === 'admin' ? request.loginId : '',
    email: request.loginType === 'google' ? request.loginId : '',
    name: request.displayName || request.loginId,
    role: request.role || 'ADMIN'
  });
  cache.remove('V6_PK_LOGIN_' + requestId);
  adminCompatAppendLoginLog_(request.loginId, request.role, '패스키 로그인 성공', params);
  return {
    ok: true,
    message: '패스키 로그인 성공',
    sessionToken: session.token,
    sessionExpiresAt: new Date(session.expiresAt).toISOString(),
    sessionExpiresAtMs: session.expiresAt,
    name: request.displayName || request.loginId,
    email: request.loginType === 'google' ? request.loginId : '',
    role: request.role || 'ADMIN',
    version: V6_SERVER_VERSION
  };
}

function v6DeletePasskey_(params) {
  var auth = adminCompatRequire_(params);
  var credentialId = String(params.credentialId || '').trim();
  if (!credentialId) return studentFail_('PASSKEY_CREDENTIAL_REQUIRED', '삭제할 패스키 정보가 없습니다.');
  var sheet = v6EnsurePasskeySheet_();
  var changed = 0;
  studentRows_(sheet).forEach(function (row) {
    if (String(row.credentialId || '') === credentialId && adminCompatTrue_(row.active)) {
      studentUpdateRow_(sheet, row._row, { active: false, lastUsedAt: new Date() });
      changed++;
    }
  });
  SpreadsheetApp.flush();
  return { ok: true, deleted: changed > 0, count: changed, credentialId: credentialId, name: auth.name || '', version: V6_SERVER_VERSION };
}

function v6ValidatedOrigin_(origin, hostname) {
  var normalizedOrigin = String(origin || '').trim().replace(/\/$/, '');
  var normalizedHost = String(hostname || '').trim().toLowerCase();
  if (normalizedOrigin !== V6_ALLOWED_ORIGIN || normalizedHost !== V6_RP_ID) {
    var error = new Error('허용되지 않은 사이트에서 패스키를 요청했습니다.');
    error.code = 'PASSKEY_ORIGIN_INVALID';
    throw error;
  }
  return normalizedOrigin;
}

function v6CheckClientData_(clientData, expectedType, expectedChallenge, expectedOrigin) {
  if (!clientData || String(clientData.type || '') !== expectedType) throw v6Error_('PASSKEY_TYPE_INVALID', '패스키 요청 종류가 올바르지 않습니다.');
  if (!studentConstantEqual_(String(clientData.challenge || ''), String(expectedChallenge || ''))) throw v6Error_('PASSKEY_CHALLENGE_INVALID', '패스키 요청 확인값이 일치하지 않습니다.');
  if (String(clientData.origin || '').replace(/\/$/, '') !== String(expectedOrigin || '').replace(/\/$/, '')) throw v6Error_('PASSKEY_ORIGIN_INVALID', '패스키 요청 사이트가 일치하지 않습니다.');
}

function v6ParseAttestation_(bytes, rpId) {
  var decoded = v6CborRead_(bytes, 0).value;
  var authData = decoded && decoded.authData;
  if (!Array.isArray(authData)) throw v6Error_('PASSKEY_ATTESTATION_INVALID', '패스키 등록 데이터를 읽지 못했습니다.');
  var parsed = v6ParseAuthenticatorData_(authData, rpId, true);
  if (!parsed.credentialId || !parsed.cose) throw v6Error_('PASSKEY_PUBLIC_KEY_MISSING', '패스키 공개키를 읽지 못했습니다.');
  var cose = parsed.cose;
  var kty = Number(cose['1']);
  var alg = Number(cose['3']);
  var crv = Number(cose['-1']);
  var x = cose['-2'];
  var y = cose['-3'];
  if (kty !== 2 || alg !== -7 || crv !== 1 || !Array.isArray(x) || !Array.isArray(y)) throw v6Error_('PASSKEY_ALGORITHM_UNSUPPORTED', '지원하지 않는 패스키 공개키 형식입니다.');
  return { credentialId: parsed.credentialId, x: x, y: y, alg: alg, signCount: parsed.signCount };
}

function v6ParseAuthenticatorData_(bytes, rpId, requireAttested) {
  if (!Array.isArray(bytes) || bytes.length < 37) throw v6Error_('PASSKEY_AUTH_DATA_INVALID', '패스키 인증 데이터가 너무 짧습니다.');
  var expectedRpHash = v6Sha256_(v6Utf8Bytes_(rpId));
  var actualRpHash = bytes.slice(0, 32);
  if (!v6BytesEqual_(expectedRpHash, actualRpHash)) throw v6Error_('PASSKEY_RP_ID_INVALID', '패스키 사이트 식별값이 일치하지 않습니다.');
  var flags = bytes[32] & 255;
  var signCount = v6ReadUint32_(bytes, 33);
  var result = { flags: flags, signCount: signCount };
  if (requireAttested) {
    if ((flags & 64) === 0 || bytes.length < 55) throw v6Error_('PASSKEY_ATTESTED_DATA_MISSING', '패스키 등록 공개키가 없습니다.');
    var offset = 53;
    var credentialLength = ((bytes[offset] & 255) << 8) | (bytes[offset + 1] & 255);
    offset += 2;
    if (credentialLength <= 0 || offset + credentialLength > bytes.length) throw v6Error_('PASSKEY_CREDENTIAL_INVALID', '패스키 ID 길이가 올바르지 않습니다.');
    result.credentialId = bytes.slice(offset, offset + credentialLength);
    offset += credentialLength;
    var coseResult = v6CborRead_(bytes, offset);
    result.cose = coseResult.value;
  }
  return result;
}
