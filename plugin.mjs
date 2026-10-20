// Sidra Controls: OpenDeck keys that control Sidra. Each key stays blank (state 0) while
// Sidra is not running and shows its control (state 1) while it is; Mute shows state 2
// while Sidra is muted. OpenDeck lets only its Starter Pack switch profiles, so a Sidra
// page is reached through Multi Actions instead (see README.md).
import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

const options = {};
for (let index = 2; index + 1 < process.argv.length; index += 2) {
  options[process.argv[index].replace(/^-+/, "")] = process.argv[index + 1];
}

const PLAYER = ["org.mpris.MediaPlayer2.sidra", "/org/mpris/MediaPlayer2"];
const PLAYBACK = "org.mpris.MediaPlayer2.Player";
const VOLUME_STEP = 0.05; // Sidra's own scroll step
const MUTE = "local.sidracontrols.mute";

const run = (command, ...args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) console.log(`${command} ${args.join(" ")}: ${stderr.trim() || error.message}`);
      resolve(error ? null : stdout);
    });
  });
const busctl = (...args) => run("busctl", "--user", ...args);
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

// Mute mutes Sidra's audio streams, as Plasma's volume mixer does, and leaves Sidra's own
// volume alone. WirePlumber remembers the mute for Sidra and applies it to the streams
// Sidra opens later, such as after a pause or a restart.
async function sidraStreams() {
  try {
    const streams = JSON.parse(await run("pactl", "-f", "json", "list", "sink-inputs"));
    return streams.filter((stream) => stream.properties["application.process.binary"] === "sidra");
  } catch {
    return [];
  }
}

async function toggleMute() {
  const streams = await sidraStreams();
  if (!streams.length) return console.log("Sidra has no audio stream to mute");
  const mute = streams.some((stream) => !stream.mute) ? "1" : "0";
  await Promise.all(streams.map((stream) => run("pactl", "set-sink-input-mute", String(stream.index), mute)));
  refreshMute();
}

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

const keys = new Map(); // context → action
let running = false;
let muted = false;
const socket = new WebSocket(`ws://127.0.0.1:${options.port}`);
const show = (context) => {
  const state = !running ? 0 : keys.get(context) === MUTE && muted ? 2 : 1;
  socket.send(JSON.stringify({ event: "setState", context, payload: { state } }));
};

// Serialized, so checks triggered by bursts of events cannot interleave.
let checks = Promise.resolve();
const update = (nowRunning, nowMuted) => {
  if (nowRunning === running && nowMuted === muted) return;
  if (nowRunning !== running) console.log(`Sidra ${nowRunning ? "is running: showing" : "stopped: blanking"} ${keys.size} keys`);
  if (nowMuted !== muted) console.log(`Sidra ${nowMuted ? "muted" : "unmuted"}`);
  [running, muted] = [nowRunning, nowMuted];
  keys.forEach((_, context) => show(context));
};
const refresh = () => (checks = checks.then(async () => update(await sidraRunning(), muted)));
// Without a stream, before Sidra plays anything, the last known mute stays.
const refreshMute = () =>
  (checks = checks.then(async () => {
    const streams = await sidraStreams();
    update(running, streams.length ? streams.every((stream) => stream.mute) : muted);
  }));

// pactl reports streams appearing and being muted or unmuted, here or anywhere else.
let events = null;
let pending = null;
function watch() {
  events = spawn("pactl", ["subscribe"], { stdio: ["ignore", "pipe", "ignore"] });
  events.stdout.setEncoding("utf8");
  events.stdout.on("data", (chunk) => {
    if (!chunk.includes(" on sink-input ")) return;
    clearTimeout(pending);
    pending = setTimeout(refreshMute, 50);
  });
  // pipewire-pulse restarted or is not up yet: catch up and listen again.
  events.on("exit", () => setTimeout(() => (watch(), refreshMute()), 2_000));
  events.on("error", (error) => console.log(`pactl subscribe: ${error.message}`));
}

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ event: options.registerEvent, uuid: options.pluginUUID }));
  watch();
  refresh();
  refreshMute();
});
socket.addEventListener("message", ({ data }) => {
  const { event, action, context } = JSON.parse(data);
  if (event === "willAppear") {
    keys.set(context, action);
    show(context);
  } else if (event === "willDisappear") {
    keys.delete(context);
  } else if (event === "keyDown" && action === MUTE && running) {
    // On press rather than release, so the sound stops at once.
    toggleMute();
  } else if (event === "keyUp" && running) {
    commands[action]?.();
  } else if (event === "applicationDidLaunch" || event === "applicationDidTerminate") {
    refresh();
  }
});
socket.addEventListener("close", () => {
  events?.removeAllListeners("exit");
  events?.kill();
  process.exit(0);
});
// OpenDeck's events miss a Sidra that quit as a zombie, so also look every two seconds.
setInterval(refresh, 2_000);
