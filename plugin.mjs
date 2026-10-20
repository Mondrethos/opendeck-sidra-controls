// Sidra Controls: OpenDeck keys that control Sidra over MPRIS. Each key shows its
// control (state 1) while Sidra runs and stays blank (state 0) otherwise.
// OpenDeck lets only its Starter Pack switch profiles, so the Sidra profile is shown by
// OpenDeck's own application profiles instead (see ~/.config/opendeck/applications.json).
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

const options = {};
for (let index = 2; index + 1 < process.argv.length; index += 2) {
  options[process.argv[index].replace(/^-+/, "")] = process.argv[index + 1];
}

const PLAYER = ["org.mpris.MediaPlayer2.sidra", "/org/mpris/MediaPlayer2"];
const PLAYBACK = "org.mpris.MediaPlayer2.Player";
const VOLUME_STEP = 0.05; // Sidra's own scroll step

const busctl = (...args) =>
  new Promise((resolve) => {
    execFile("busctl", ["--user", ...args], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) console.log(`busctl ${args.join(" ")}: ${stderr.trim() || error.message}`);
      resolve(error ? null : stdout);
    });
  });
const call = (iface, method) => busctl("call", ...PLAYER, iface, method);

async function changeVolume(step) {
  const reply = await busctl("get-property", ...PLAYER, PLAYBACK, "Volume");
  const current = Number(reply?.trim().split(/\s+/)[1]);
  if (!Number.isFinite(current)) return;
  const volume = Math.min(1, Math.max(0, Math.round((current + step) * 100) / 100));
  await busctl("set-property", ...PLAYER, PLAYBACK, "Volume", "d", String(volume));
}

const commands = {
  "local.sidracontrols.previous": () => call(PLAYBACK, "Previous"),
  "local.sidracontrols.playpause": () => call(PLAYBACK, "PlayPause"),
  "local.sidracontrols.next": () => call(PLAYBACK, "Next"),
  "local.sidracontrols.stop": () => call(PLAYBACK, "Stop"),
  "local.sidracontrols.quit": () => call("org.mpris.MediaPlayer2", "Quit"),
  "local.sidracontrols.volumedown": () => changeVolume(-VOLUME_STEP),
  "local.sidracontrols.volumeup": () => changeVolume(VOLUME_STEP),
};

// Sidra runs while a live process named "sidra" exists. Zombies do not count: the Launch App plugin
// never reaps what it starts, so a Sidra opened from a key stays a zombie after it quits.
async function sidraRunning() {
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      // "PID (comm) state ...": comm may contain spaces or parentheses, the state follows the last ")".
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      if (stat.slice(stat.indexOf("(") + 1, end) === "sidra" && !"ZX".includes(stat[end + 2])) return true;
    } catch {
      // The process exited while we looked.
    }
  }
  return false;
}

const keys = new Set();
let running = false;
const socket = new WebSocket(`ws://127.0.0.1:${options.port}`);
const show = (context) =>
  socket.send(JSON.stringify({ event: "setState", context, payload: { state: running ? 1 : 0 } }));

// Serialized, so checks triggered by bursts of process events cannot interleave.
let checks = Promise.resolve();
const refresh = () =>
  (checks = checks.then(async () => {
    const now = await sidraRunning();
    if (now !== running) {
      running = now;
      console.log(`Sidra ${running ? "is running: showing" : "stopped: blanking"} ${keys.size} keys`);
      keys.forEach(show);
    }
  }));

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ event: options.registerEvent, uuid: options.pluginUUID }));
  refresh();
});
socket.addEventListener("message", ({ data }) => {
  const { event, action, context } = JSON.parse(data);
  if (event === "willAppear") {
    keys.add(context);
    show(context);
  } else if (event === "willDisappear") {
    keys.delete(context);
  } else if (event === "keyUp" && running) {
    commands[action]?.();
  } else if (event === "applicationDidLaunch" || event === "applicationDidTerminate") {
    refresh();
  }
});
socket.addEventListener("close", () => process.exit(0));
// OpenDeck's events miss a Sidra that quit as a zombie, so also look every two seconds.
setInterval(refresh, 2_000);
