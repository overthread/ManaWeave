/** Login/registration composition root. Sessions are per-tab (sessionStorage). */
import { api, setSession, clearSession, getLastUsername, showError } from "./shared.js";

const params = new URLSearchParams(location.search);
const next = params.get("next") || "/lobby.html";

// "?switch=1" forces a fresh login — used by the "open second seat" link,
// because a tab opened via window.open inherits a *copy* of this session.
if (params.get("switch") === "1") clearSession();

let mode = "login";

const $ = (id) => document.getElementById(id);

function renderMode() {
  const login = mode === "login";
  $("form-title").textContent = login ? "Log in" : "Register";
  $("submit-btn").textContent = login ? "Log in" : "Register & log in";
  $("switch-text").textContent = login ? "No account yet?" : "Already registered?";
  $("switch-link").textContent = login ? "Register one" : "Log in instead";
  $("display-name-row").style.display = login ? "none" : "";
  $("password").autocomplete = login ? "current-password" : "new-password";
}

$("switch-link").addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "register" : "login";
  renderMode();
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("username").value.trim();
  const password = $("password").value;
  if (!username || !password) {
    showError("Username and password, please.");
    return;
  }
  try {
    const body =
      mode === "register"
        ? { username, password, displayName: $("display-name").value.trim() || undefined }
        : { username, password };
    const data = await api(`/api/auth/${mode === "register" ? "register" : "login"}`, { method: "POST", body });
    setSession({ token: data.token, accountId: data.account.id, username: data.account.username, displayName: data.account.displayName });
    location.href = next.startsWith("/") ? next : "/lobby.html";
  } catch (err) {
    showError(err.message);
  }
});

$("username").value = getLastUsername();
renderMode();
$("username").focus();
