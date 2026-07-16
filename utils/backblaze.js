const axios = require("axios");

const B2_KEY_ID =
  process.env.B2_KEY_ID ||
  process.env.B2_APPLICATION_KEY_ID ||
  process.env.BACKBLAZE_KEY_ID ||
  process.env.B2_ACCOUNT_ID ||
  "";
const B2_APP_KEY =
  process.env.B2_APPLICATION_KEY ||
  process.env.B2_APP_KEY ||
  process.env.BACKBLAZE_APPLICATION_KEY ||
  "";
const RAW_API_URL = process.env.B2_API_URL || "https://api.backblazeb2.com/b2api/v2";
const FALLBACK_BUCKET_NAME = process.env.B2_BUCKET_NAME || process.env.BACKBLAZE_BUCKET || "";

const BACKBLAZE_HOST_SNIPPET = ".backblazeb2.com";

const API_URL = RAW_API_URL.replace(/\/+$/u, "");

let cachedAuth = null;

const hasBackblazeCredentials = () => Boolean(B2_KEY_ID && B2_APP_KEY);

const isBackblazeUrl = (url) => {
  if (!url || typeof url !== "string") {
    return false;
  }
  return url.includes(BACKBLAZE_HOST_SNIPPET);
};

const parseBackblazeUrl = (url) => {
  if (!isBackblazeUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/^\/+/u, "").split("/");

    if (segments.length < 2) {
      return null;
    }

    let bucketSegment = segments[0];
    let keySegments = segments.slice(1);

    if (bucketSegment === "file" && segments.length >= 3) {
      bucketSegment = segments[1];
      keySegments = segments.slice(2);
    }

    const bucket = bucketSegment || FALLBACK_BUCKET_NAME || null;
    const key = keySegments.join("/");

    if (!bucket || !key) {
      return null;
    }

    return { bucket, key };
  } catch (error) {
    console.warn("parseBackblazeUrl: failed to parse url", error?.message || error);
    if (FALLBACK_BUCKET_NAME) {
      const sanitized = url.replace(/^https?:\/\/[^/]+\/+/i, "");
      return { bucket: FALLBACK_BUCKET_NAME, key: sanitized };
    }
    return null;
  }
};

const authorizeBackblaze = async (forceRefresh = false) => {
  if (!hasBackblazeCredentials()) {
    const err = new Error("Backblaze credentials are not configured");
    err.code = "B2_CREDENTIALS_MISSING";
    throw err;
  }

  if (!forceRefresh && cachedAuth && cachedAuth.expiresAt > Date.now()) {
    return cachedAuth;
  }

  const authHeader = Buffer.from(`${B2_KEY_ID}:${B2_APP_KEY}`).toString("base64");

  const response = await axios.get(`${API_URL}/b2_authorize_account`, {
    headers: {
      Authorization: `Basic ${authHeader}`,
    },
  });

  const data = response?.data || {};
  const ttlMs = 1000 * 60 * 30; // refresh every 30 minutes

  cachedAuth = {
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    authorizationToken: data.authorizationToken,
    allowed: data.allowed || {},
    expiresAt: Date.now() + ttlMs,
  };

  return cachedAuth;
};

const downloadWithAuthorization = async (downloadUrl, token) => {
  const response = await axios.get(downloadUrl, {
    responseType: "stream",
    headers: {
      Authorization: token,
    },
  });

  return {
    stream: response.data,
    contentType: response.headers["content-type"] || "application/octet-stream",
  };
};

const fetchBackblazeStream = async (bucket, key) => {
  const effectiveBucket = bucket || FALLBACK_BUCKET_NAME;
  if (!effectiveBucket || !key) {
    const err = new Error("Invalid Backblaze file reference");
    err.code = "B2_INVALID_REFERENCE";
    throw err;
  }

  let auth = await authorizeBackblaze();

  const buildDownloadUrl = (authPayload) =>
    `${authPayload.downloadUrl}/file/${effectiveBucket}/${encodeURIComponent(key)}`.replace(
      /%2F/gu,
      "/"
    );

  try {
    return await downloadWithAuthorization(
      buildDownloadUrl(auth),
      auth.authorizationToken
    );
  } catch (error) {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      auth = await authorizeBackblaze(true);
      return await downloadWithAuthorization(
        buildDownloadUrl(auth),
        auth.authorizationToken
      );
    }
    throw error;
  }
};

module.exports = {
  hasBackblazeCredentials,
  isBackblazeUrl,
  parseBackblazeUrl,
  fetchBackblazeStream,
};
