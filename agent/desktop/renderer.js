const api = window.hyzrAgent;
const form = document.querySelector("#pair-form");
const connected = document.querySelector("#connected");
const pairButton = document.querySelector("#pair");
const statusDot = document.querySelector("#status-dot");
let workspaceRoot = "";

function render(state) {
  const active = ["connected", "reconnecting"].includes(state.phase);
  form.hidden = active;
  connected.hidden = !active;
  statusDot.classList.toggle("on", state.phase === "connected");
  pairButton.disabled = state.phase === "connecting";
  pairButton.textContent = state.phase === "connecting" ? "Connecting…" : "Pair computer";
  document.querySelector("#status-text").textContent = state.message || "Paired and listening";
  if (state.capabilities) {
    const items = [
      ["Claude Code", state.capabilities.claude],
      ["Codex", state.capabilities.codex],
      ["Git", state.capabilities.git],
      ["GitHub CLI", state.capabilities.gh],
    ];
    document.querySelector("#tools").innerHTML = items.map(([name, ready]) =>
      `<div class="tool"><span>${name}</span><b class="${ready ? "" : "missing"}">${ready ? "Ready" : "Not found"}</b></div>`
    ).join("");
  }
  if (state.phase === "error") alert(state.message);
}

api.defaults().then((defaults) => {
  document.querySelector("#relay").value = defaults.relay;
  document.querySelector("#workspace").value = defaults.workspaceRoot;
  const permission = document.querySelector(`input[name="permission"][value="${defaults.permissionMode}"]`);
  if (permission) permission.checked = true;
  document.querySelector("#version").textContent = `Hyzr Agent ${defaults.version}`;
  workspaceRoot = defaults.workspaceRoot;
  render(defaults.state);
});
api.onState(render);
api.onPairLink((values) => {
  if (values.relay) document.querySelector("#relay").value = values.relay;
  if (values.code) document.querySelector("#code").value = values.code;
  window.focus();
});

document.querySelector("#browse").addEventListener("click", async () => {
  const folder = await api.chooseFolder();
  if (folder) {
    workspaceRoot = folder;
    document.querySelector("#workspace").value = folder;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  workspaceRoot = document.querySelector("#workspace").value;
  await api.pair({
    code: document.querySelector("#code").value,
    relay: document.querySelector("#relay").value,
    workspaceRoot,
    permissionMode: document.querySelector('input[name="permission"]:checked').value,
    startAtLogin: document.querySelector("#startup").checked,
  });
});

document.querySelector("#code-promo").addEventListener("click", (event) => {
  event.preventDefault();
  api.openExternal(event.currentTarget.href);
});
document.querySelector("#open-folder").addEventListener("click", () => api.openWorkspaces(workspaceRoot));
document.querySelector("#disconnect").addEventListener("click", async () => render(await api.disconnect()));
