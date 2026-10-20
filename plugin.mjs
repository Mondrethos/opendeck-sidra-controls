// Sidra Controls: OpenDeck keys that control Sidra. Each key stays blank (state 0) while
// Sidra is not running and shows its control (state 1) while it is. Mute, Repeat Song and
// Repeat All show state 2 while they are on. OpenDeck lets only its Starter Pack switch
// profiles, so a Sidra page is reached through Multi Actions instead (see README.md).
import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const options = {};
for (let index = 2; index + 1 < process.argv.length; index += 2) {
  options[process.argv[index].replace(/^-+/, "")] = process.argv[index + 1];
}

const PLAYER = ["org.mpris.MediaPlayer2.sidra", "/org/mpris/MediaPlayer2"];
const PLAYBACK = "org.mpris.MediaPlayer2.Player";
const VOLUME_STEP = 0.05; // Sidra's own scroll step
const MUTE = "local.sidracontrols.mute";
const REPEAT_SONG = "local.sidracontrols.repeatsong";
const REPEAT_ALL = "local.sidracontrols.repeatall";
// The MPRIS LoopStatus that each repeat key turns on.
const REPEATS = { [REPEAT_SONG]: "Track", [REPEAT_ALL]: "Playlist" };

const run = (command, ...args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) console.log(`${command} ${args.join(" ")}: ${stderr.trim() || error.message}`);
      resolve(error ? null : stdout);
    });
  });
// "--" ends busctl's options, so that a negative number is read as an argument.
const busctl = (...args) => run("busctl", "--user", "--", ...args);
const call = (iface, method, ...args) => busctl("call", ...PLAYER, iface, method, ...args);

async function changeVolume(step) {
  const reply = await busctl("get-property", ...PLAYER, PLAYBACK, "Volume");
  const current = Number(reply?.trim().split(/\s+/)[1]);
  if (!Number.isFinite(current)) return;
  const volume = Math.min(1, Math.max(0, Math.round((current + step) * 100) / 100));
  await busctl("set-property", ...PLAYER, PLAYBACK, "Volume", "d", String(volume));
}

// MPRIS puts a seek back past the start of the song at its start. Playing from there
// starts a paused song over too.
async function restart() {
  await call(PLAYBACK, "Seek", "x", String(-Number.MAX_SAFE_INTEGER));
  await call(PLAYBACK, "Play");
}

// Sidra's repeat mode, as MPRIS LoopStatus: "None", "Track" or "Playlist".
async function loopStatus() {
  const reply = await busctl("get-property", ...PLAYER, PLAYBACK, "LoopStatus");
  return reply?.match(/^s "(\w+)"/)?.[1];
}

// A repeat key turns its mode on, or repeating off when its mode is already on.
async function toggleRepeat(action) {
  const mode = REPEATS[action];
  const current = (await loopStatus()) ?? status.loop;
  await busctl("set-property", ...PLAYER, PLAYBACK, "LoopStatus", "s", current === mode ? "None" : mode);
  refreshLoop();
}

const commands = {
  "local.sidracontrols.previous": () => call(PLAYBACK, "Previous"),
  "local.sidracontrols.playpause": () => call(PLAYBACK, "PlayPause"),
  "local.sidracontrols.next": () => call(PLAYBACK, "Next"),
  "local.sidracontrols.stop": () => call(PLAYBACK, "Stop"),
  "local.sidracontrols.quit": () => call("org.mpris.MediaPlayer2", "Quit"),
  "local.sidracontrols.volumedown": () => changeVolume(-VOLUME_STEP),
  "local.sidracontrols.volumeup": () => changeVolume(VOLUME_STEP),
  "local.sidracontrols.restart": restart,
  [REPEAT_SONG]: () => toggleRepeat(REPEAT_SONG),
  [REPEAT_ALL]: () => toggleRepeat(REPEAT_ALL),
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
const status = { running: false, muted: false, loop: "None" };
// Whether each toggle key is on, showing state 2.
const on = {
  [MUTE]: () => status.muted,
  [REPEAT_SONG]: () => status.loop === REPEATS[REPEAT_SONG],
  [REPEAT_ALL]: () => status.loop === REPEATS[REPEAT_ALL],
};
const socket = new WebSocket(`ws://127.0.0.1:${options.port}`);
const show = (context) => {
  const state = !status.running ? 0 : on[keys.get(context)]?.() ? 2 : 1;
  socket.send(JSON.stringify({ event: "setState", context, payload: { state } }));
};

const describe = {
  running: (running) => `Sidra ${running ? "is running: showing" : "stopped: blanking"} ${keys.size} keys`,
  muted: (muted) => `Sidra ${muted ? "muted" : "unmuted"}`,
  loop: (loop) => `Sidra repeat: ${loop}`,
};
const update = (changes) => {
  const changed = Object.keys(changes).filter((name) => changes[name] !== status[name]);
  if (!changed.length) return;
  Object.assign(status, changes);
  changed.forEach((name) => console.log(describe[name](status[name])));
  keys.forEach((_, context) => show(context));
};

// Serialized, so checks triggered by bursts of events cannot interleave.
let checks = Promise.resolve();
const serially = (check) =>
  (checks = checks.then(check).catch((error) => console.log(`check failed: ${error.message}`)));
const refresh = () => serially(async () => update({ running: await sidraRunning() }));
const refreshLoop = () => serially(async () => update({ loop: (await loopStatus()) ?? status.loop }));
// Without a stream, before Sidra plays anything, the last known mute stays.
const refreshMute = () =>
  serially(async () => {
    const streams = await sidraStreams();
    update({ muted: streams.length ? streams.every((stream) => stream.mute) : status.muted });
  });

// Monitors that print a line per event. One that exits, because its server restarted or
// is not up yet, starts again and catches up on what it missed.
const monitors = new Set();
function monitor(command, args, onLine, catchUp) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
  monitors.add(child);
  createInterface({ input: child.stdout }).on("line", onLine);
  child.on("error", (error) => console.log(`${command}: ${error.message}`));
  child.on("exit", () => {
    monitors.delete(child);
    setTimeout(() => (monitor(command, args, onLine, catchUp), catchUp?.()), 2_000);
  });
}

// pactl reports Sidra's streams appearing and being muted or unmuted, here or anywhere else.
let pending = null;
const streamEvent = (line) => {
  if (!line.includes(" on sink-input ")) return;
  clearTimeout(pending);
  pending = setTimeout(refreshMute, 50);
};
// gdbus reports Sidra appearing on the bus, including when gdbus starts, and its repeat
// mode changing, here or in Sidra.
const sidraSignal = (line) => {
  const loop = line.match(/'LoopStatus': <'(\w+)'>/)?.[1];
  if (loop) serially(async () => update({ loop }));
  else if (line.includes(" is owned by ")) refreshLoop();
};

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ event: options.registerEvent, uuid: options.pluginUUID }));
  monitor("pactl", ["subscribe"], streamEvent, refreshMute);
  monitor("gdbus", ["monitor", "--session", "--dest", PLAYER[0], "--object-path", PLAYER[1]], sidraSignal);
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
  } else if (event === "keyDown" && action === MUTE && status.running) {
    // On press rather than release, so the sound stops at once.
    toggleMute();
  } else if (event === "keyUp" && status.running) {
    commands[action]?.();
  } else if (event === "applicationDidLaunch" || event === "applicationDidTerminate") {
    refresh();
  }
});
socket.addEventListener("close", () => {
  monitors.forEach((child) => child.removeAllListeners("exit").kill());
  process.exit(0);
});
// OpenDeck's events miss a Sidra that quit as a zombie, so also look every two seconds.
setInterval(refresh, 2_000);
