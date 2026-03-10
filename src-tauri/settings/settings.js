const { invoke } = window.__TAURI__.core;

const FIELDS = {
  SLACK_USER_TOKEN: "slack-user-token",
  SLACK_APP_TOKEN: "slack-app-token",
  SLACK_USER_ID: "slack-user-id",
  TODO_EMOJI: "todo-emoji",
  TODO_FILE_PATH: "todo-file-path",
  TODO_SUFFIX: "todo-suffix",
};

const DEFAULTS = {
  TODO_EMOJI: "yyk-todo",
};

function showMessage(text, type) {
  const el = document.getElementById("message");
  el.textContent = text;
  el.className = type;
}

async function loadConfig() {
  try {
    const config = await invoke("read_config");
    for (const [key, id] of Object.entries(FIELDS)) {
      const el = document.getElementById(id);
      if (config[key]) {
        el.value = config[key];
      } else if (DEFAULTS[key]) {
        el.value = DEFAULTS[key];
      }
    }
  } catch (e) {
    showMessage("Failed to load config: " + e, "error");
  }
}

async function saveConfig() {
  const config = {};
  for (const [key, id] of Object.entries(FIELDS)) {
    const val = document.getElementById(id).value.trim();
    if (val) config[key] = val;
  }
  try {
    await invoke("write_config", { config });
    document.getElementById("message").innerHTML = "";
    document.getElementById("message").className = "success";

    const text = document.createTextNode("Settings saved. ");
    const btn = document.createElement("a");
    btn.href = "#";
    btn.textContent = "Restart now";
    btn.style.cssText = "color: inherit; font-weight: 600; text-decoration: underline; cursor: pointer;";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      await invoke("restart_app");
    });

    document.getElementById("message").appendChild(text);
    document.getElementById("message").appendChild(btn);

    document
      .querySelectorAll("input, button:not(#cancel)")
      .forEach((el) => (el.disabled = true));
  } catch (e) {
    showMessage("Failed to save: " + e, "error");
  }
}

document.getElementById("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveConfig();
});

document.getElementById("cancel").addEventListener("click", async () => {
  await invoke("close_settings");
});

document.getElementById("browse").addEventListener("click", async () => {
  try {
    const path = await window.__TAURI__.dialog.open({
      title: "Select Todo File",
      directory: false,
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      document.getElementById("todo-file-path").value = path;
    }
  } catch (e) {
    showMessage("Failed to open file picker: " + e, "error");
  }
});

loadConfig();
