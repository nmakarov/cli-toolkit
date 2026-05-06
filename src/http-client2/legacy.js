class HTTP {
    constructor(baseURL = "", timeout = 5000) {
        this.baseURL = baseURL;
        this.timeout = timeout;
        this.interceptors = { request: [], response: [] };
    }
  
    async request(url, options = {}) {
        // Apply request interceptors
        let config = { ...options };
        for (const interceptor of this.interceptors.request) {
            config = await interceptor(config);
        }
  
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
  
        try {
            const response = await fetch(this.baseURL + url, {
                ...config,
                signal: controller.signal
            });
  
            clearTimeout(timeoutId);
  
            // Axios-style error handling (throw on bad status)
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
  
            // Auto-parse JSON (like Axios does)
            const data = await response.json();
  
            // Apply response interceptors
            let result = { data, status: response.status, headers: response.headers };
            for (const interceptor of this.interceptors.response) {
                result = await interceptor(result);
            }
  
            return result;
  
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("Request timeout");
            }
            throw error;
        }
    }
  
    // Convenience methods
    get(url, options) { 
        return this.request(url, { ...options, method: "GET" }); 
    }
    
    post(url, data, options) { 
        return this.request(url, { 
            ...options, 
            method: "POST", 
            headers: { "Content-Type": "application/json", ...options?.headers },
            body: JSON.stringify(data) 
        }); 
    }
    
    put(url, data, options) { 
        return this.request(url, { 
            ...options, 
            method: "PUT", 
            headers: { "Content-Type": "application/json", ...options?.headers },
            body: JSON.stringify(data) 
        }); 
    }
    
    delete(url, options) { 
        return this.request(url, { ...options, method: "DELETE" }); 
    }
  
    // Interceptor support
    addRequestInterceptor(fn) { 
        this.interceptors.request.push(fn); 
    }
    
    addResponseInterceptor(fn) { 
        this.interceptors.response.push(fn); 
    }
}
  
export default HTTP;
  