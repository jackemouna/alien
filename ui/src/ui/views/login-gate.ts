import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";
import { normalizeBasePath } from "../navigation.ts";
import { agentLogoUrl } from "./agents-utils.ts";
import { renderConnectCommand } from "./connect-command.ts";

export function renderLoginGate(state: AppViewState) {
  const basePath = normalizeBasePath(state.basePath ?? "");
  const faviconSrc = agentLogoUrl(basePath);

  return html`
    <div class="login-gate">
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src=${faviconSrc} alt="Alien" />
          <div class="login-gate__title">Alien</div>
          <div class="login-gate__sub">${t("login.subtitle")}</div>
        </div>
        <div class="login-gate__form">
          <label class="field">
            <span>Paste your gateway token</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayToken ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.settings.token}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.applySettings({ ...state.settings, token: v });
                }}
                placeholder="paste here, then press Connect"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    state.connect();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayToken ? "active" : ""}"
                title=${state.loginShowGatewayToken ? t("login.hideToken") : t("login.showToken")}
                aria-label=${t("login.toggleTokenVisibility")}
                aria-pressed=${state.loginShowGatewayToken}
                @click=${() => {
                  state.loginShowGatewayToken = !state.loginShowGatewayToken;
                }}
              >
                ${state.loginShowGatewayToken ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          <button class="btn primary login-gate__connect" @click=${() => state.connect()}>
            ${t("common.connect")}
          </button>
          <button
            type="button"
            class="login-gate__advanced-toggle"
            style="background: none; border: none; color: var(--muted, #888); font-size: 12px; cursor: pointer; margin-top: 8px; text-align: left; padding: 4px 0;"
            @click=${() => {
              state.loginAdvancedOpen = !state.loginAdvancedOpen;
            }}
          >
            ${state.loginAdvancedOpen ? "▾" : "▸"} Advanced — change server URL or use a password
          </button>
          ${state.loginAdvancedOpen
            ? html`
                <label class="field">
                  <span>Gateway URL</span>
                  <input
                    .value=${state.settings.gatewayUrl}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      state.applySettings({ ...state.settings, gatewayUrl: v });
                    }}
                    placeholder="ws://127.0.0.1:18789"
                  />
                </label>
                <label class="field">
                  <span>Password (only if your gateway uses password auth)</span>
                  <div class="login-gate__secret-row">
                    <input
                      type=${state.loginShowGatewayPassword ? "text" : "password"}
                      autocomplete="off"
                      spellcheck="false"
                      .value=${state.password}
                      @input=${(e: Event) => {
                        const v = (e.target as HTMLInputElement).value;
                        state.password = v;
                      }}
                      placeholder="${t("login.passwordPlaceholder")}"
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                          state.connect();
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                      title=${state.loginShowGatewayPassword
                        ? t("login.hidePassword")
                        : t("login.showPassword")}
                      aria-label=${t("login.togglePasswordVisibility")}
                      aria-pressed=${state.loginShowGatewayPassword}
                      @click=${() => {
                        state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                      }}
                    >
                      ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
                    </button>
                  </div>
                </label>
              `
            : ""}
        </div>
        ${state.lastError
          ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${state.lastError}</div>
            </div>`
          : ""}
        <div class="login-gate__help">
          <div class="login-gate__help-title">First time here?</div>
          <ol class="login-gate__steps">
            <li>
              Start the gateway in your terminal: ${renderConnectCommand("pnpm alien gateway run")}
            </li>
            <li>
              Copy the token you persisted with
              ${renderConnectCommand("pnpm alien config set gateway.auth.token <yours>")}
            </li>
            <li>Paste it above and click Connect.</li>
          </ol>
          <div class="login-gate__docs">
            <a
              class="session-link"
              href="https://github.com/jackemouna/alien/blob/main/docs/getting-started.md"
              target="_blank"
              rel="noreferrer"
              >Full walkthrough →</a
            >
          </div>
        </div>
      </div>
    </div>
  `;
}
