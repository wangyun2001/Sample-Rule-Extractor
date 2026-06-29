import { defineStore } from "pinia";
import type {
  ApiProvider,
  LlmApiTestResult,
  LlmConfigState,
  LlmEndpointConfig
} from "../types/workflow";

const STORAGE_KEY = "sample-rule-extractor.llm.v1";

function createDefaultLlmEndpoint(): LlmEndpointConfig {
  return {
    id: "default-openai",
    label: "OpenAI Default",
    provider: "openai",
    api_base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-4o-mini",
    last_test: null
  };
}

function createLlmConfig(): LlmConfigState {
  return {
    api_base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-4o-mini",
    last_test: null
  };
}

export const useLlmStore = defineStore("llm", {
  state: () => ({
    llmConfig: createLlmConfig() as LlmConfigState,
    llmConfigs: [createDefaultLlmEndpoint()] as LlmEndpointConfig[],
    activeLlmConfigId: "default-openai" as string
  }),
  getters: {
    activeLlmConfig(state): LlmEndpointConfig | null {
      return state.llmConfigs.find((item) => item.id === state.activeLlmConfigId) ?? null;
    }
  },
  actions: {
    getActiveLlmConfig(): LlmEndpointConfig {
      let active = this.llmConfigs.find((item) => item.id === this.activeLlmConfigId);
      if (!active) {
        const fallback = this.llmConfigs[0] ?? createDefaultLlmEndpoint();
        if (!this.llmConfigs.length) {
          this.llmConfigs = [fallback];
        }
        this.activeLlmConfigId = fallback.id;
        active = fallback;
      }
      this.llmConfig = {
        api_base_url: active.api_base_url,
        api_key: active.api_key,
        model: active.model,
        last_test: active.last_test
      };
      return active;
    },
    setLlmConfig(config: { apiBaseUrl: string; apiKey: string; model: string }) {
      const active = this.getActiveLlmConfig();
      active.api_base_url = config.apiBaseUrl.trim();
      active.api_key = config.apiKey.trim();
      active.model = config.model.trim();
      this.llmConfig.api_base_url = active.api_base_url;
      this.llmConfig.api_key = active.api_key;
      this.llmConfig.model = active.model;
      this.persistState();
    },
    setActiveLlmConfig(id: string) {
      this.activeLlmConfigId = id;
      this.getActiveLlmConfig();
      this.persistState();
    },
    addLlmConfig(provider: ApiProvider = "custom") {
      const created: LlmEndpointConfig = {
        id: `cfg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        label: provider === "openai" ? "OpenAI Config" : provider === "gemini" ? "Gemini Config" : "Custom Config",
        provider,
        api_base_url: provider === "openai" ? "https://api.openai.com/v1" : "",
        api_key: "",
        model: provider === "openai" ? "gpt-4o-mini" : "",
        last_test: null
      };
      this.llmConfigs.unshift(created);
      this.activeLlmConfigId = created.id;
      this.getActiveLlmConfig();
      this.persistState();
    },
    updateLlmConfigItem(id: string, patch: Partial<LlmEndpointConfig>) {
      const item = this.llmConfigs.find((cfg) => cfg.id === id);
      if (!item) {
        return;
      }
      Object.assign(item, patch);
      if (id === this.activeLlmConfigId) {
        this.getActiveLlmConfig();
      }
      this.persistState();
    },
    removeLlmConfig(id: string) {
      if (this.llmConfigs.length <= 1) {
        return;
      }
      this.llmConfigs = this.llmConfigs.filter((cfg) => cfg.id !== id);
      if (this.activeLlmConfigId === id) {
        this.activeLlmConfigId = this.llmConfigs[0].id;
      }
      this.getActiveLlmConfig();
      this.persistState();
    },
    setLlmTestResult(result: LlmApiTestResult) {
      const active = this.getActiveLlmConfig();
      active.last_test = result;
      this.llmConfig.last_test = result;
      this.persistState();
    },
    ensureDefaults() {
      if (!this.llmConfigs || this.llmConfigs.length === 0) {
        const fallback = createDefaultLlmEndpoint();
        this.llmConfigs = [fallback];
        this.activeLlmConfigId = fallback.id;
      }
      this.getActiveLlmConfig();
    },
    persistState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          llmConfigs: this.llmConfigs,
          activeLlmConfigId: this.activeLlmConfigId
        })
      );
    },
    hydrateState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.ensureDefaults();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as { llmConfigs?: LlmEndpointConfig[]; activeLlmConfigId?: string };
        if (parsed.llmConfigs?.length) {
          this.llmConfigs = parsed.llmConfigs;
        }
        if (parsed.activeLlmConfigId) {
          this.activeLlmConfigId = parsed.activeLlmConfigId;
        }
        this.ensureDefaults();
      } catch {
        this.ensureDefaults();
      }
    }
  }
});
