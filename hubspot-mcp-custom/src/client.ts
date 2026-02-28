/**
 * HubSpot REST API client with structured errors and rate-limit handling.
 */

const BASE_URL = "https://api.hubapi.com";

export interface HubSpotError {
  status: number;
  category: string;
  message: string;
  suggestion?: string;
}

export class HubSpotApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly category: string,
    message: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = "HubSpotApiError";
  }

  toJSON(): HubSpotError {
    return {
      status: this.status,
      category: this.category,
      message: this.message,
      ...(this.suggestion ? { suggestion: this.suggestion } : {}),
    };
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class HubSpotClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Make an authenticated request to the HubSpot API.
   * Handles rate limiting with automatic retry (once).
   */
  async request<T = unknown>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = "GET", params, body } = options;

    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response = await fetch(url.toString(), fetchOptions);

    // Rate limit: wait and retry once
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10_000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 30_000)));
      response = await fetch(url.toString(), fetchOptions);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let parsed: { category?: string; message?: string } = {};
      try {
        parsed = JSON.parse(errorBody);
      } catch {
        // not JSON
      }

      const category = parsed.category || statusToCategory(response.status);
      const message = parsed.message || errorBody || response.statusText;
      const suggestion = getSuggestion(response.status, category, path);

      throw new HubSpotApiError(response.status, category, message, suggestion);
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** Convenience for GET requests */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { params });
  }

  /** Convenience for POST requests */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }
}

function statusToCategory(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "AUTHENTICATION_ERROR";
    case 403:
      return "PERMISSION_DENIED";
    case 404:
      return "OBJECT_NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMIT";
    default:
      return status >= 500 ? "SERVER_ERROR" : "CLIENT_ERROR";
  }
}

function getSuggestion(
  status: number,
  category: string,
  path: string
): string | undefined {
  if (status === 404) {
    return "Check the object type and ID. Use list_objects or search_crm to find valid IDs.";
  }
  if (status === 403) {
    if (path.includes("sequences")) {
      return "Sequences API requires Sales Hub Professional or Enterprise.";
    }
    if (path.includes("analytics")) {
      return "Analytics API may require Marketing Hub Professional or Enterprise.";
    }
    if (path.includes("automation")) {
      return "Workflows API requires the 'automation' scope on your Private App.";
    }
    return "Check that your Private App has the required scopes for this endpoint.";
  }
  if (status === 401) {
    return "The access token is invalid or expired. Check HUBSPOT_ACCESS_TOKEN.";
  }
  return undefined;
}
