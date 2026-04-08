let config = null;

export async function loadConfig() {
  if (config) return config;
  
  try {
    const response = await fetch('/config.json');
    if (!response.ok) throw new Error('Failed to load config');
    config = await response.json();
  } catch (error) {
    console.error('Error loading config:', error);
    // Fallback to default
    config = {
      backend_url: 'https://campuskart-backend-y3qp.onrender.com'
    };
  }
  
  return config;
}

export async function getBackendUrl() {
  const cfg = await loadConfig();
  return cfg.backend_url;
}
