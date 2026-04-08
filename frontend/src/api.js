import { getBackendUrl } from "./utils/config.js";

let baseUrl = "";

// Load config on app start
(async () => {
  baseUrl = await getBackendUrl();
})();

export function getToken() {
  return localStorage.getItem("ck_token");
}

export async function api(path, options = {}) {
  // Ensure base URL is loaded
  if (!baseUrl) {
    baseUrl = await getBackendUrl();
  }
  
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || "Request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function assetUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${baseUrl}${path}`;
}
