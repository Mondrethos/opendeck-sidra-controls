# Sidra Controls for OpenDeck

An [OpenDeck](https://github.com/nekename/OpenDeck) plugin with Stream Deck keys
that control [Sidra](https://github.com/wimpysworld/sidra), the Apple Music
client for Linux. Each key shows its control while Sidra is running and stays
blank while it is not.

| Action | Does |
| --- | --- |
| Previous | previous track |
| Play/Pause | plays or pauses |
| Next | next track |
| Stop | stops playback |
| Close Sidra | quits Sidra |
| Volume Down / Volume Up | changes Sidra's volume by 5%, the same step as Sidra's scroll wheel |
| Mute | mutes or unmutes Sidra at once, leaving its volume alone; turns red while muted |
| Restart Song | plays the current song from the start, also when it is paused |
| Repeat Song | repeats the current song; turns amber while on, and another press stops repeating |
| Repeat All | repeats the whole album, playlist or queue; turns amber while on, and another press stops repeating |

The keys always control Sidra itself (`org.mpris.MediaPlayer2.sidra`), never
whichever other media player happens to be playing.

## Requirements

- Linux with a systemd user session (`busctl`)
- PipeWire with WirePlumber and its PulseAudio server (`pactl`), for Mute
- GLib's `gdbus`, for the repeat keys to show Sidra's repeat mode
- OpenDeck 2.x
- Node.js 20 or newer
- Sidra

## Install

Put this folder in OpenDeck's plugin directory under the plugin's ID, then
restart OpenDeck:

```bash
git clone https://github.com/Mondrethos/opendeck-sidra-controls.git \
  ~/.config/opendeck/plugins/local.sidracontrols.sdPlugin
```

The actions appear in OpenDeck's action list under **Sidra**.

## How it works

- Commands go to Sidra over MPRIS with `busctl --user`, except Mute.
- Restart Song seeks back past the start of the song, which MPRIS puts at the
  start, then plays.
- Repeat Song and Repeat All set Sidra's MPRIS `LoopStatus` to `Track` or
  `Playlist`, or back to `None`. They follow it with `gdbus monitor`, so a
  repeat mode chosen in Sidra itself shows on the keys too.
- Mute mutes Sidra's audio streams with `pactl`, as Plasma's volume mixer does,
  on key press rather than release. WirePlumber remembers the mute and applies
  it to the streams Sidra opens later, such as after a pause. The key also
  follows mutes made elsewhere, such as in the mixer.
- Sidra counts as running while a live process named `sidra` exists. Zombie
  processes are ignored: OpenDeck's Launch App plugin never reaps the programs
  it starts, so a Sidra opened from a Launch App key lingers as a zombie after
  it quits.
- The plugin checks when OpenDeck reports a `sidra` process starting or exiting,
  and every two seconds, because OpenDeck misses an exit that leaves a zombie.

## A Sidra page

OpenDeck accepts profile switches only from its own Starter Pack, so this
plugin cannot change pages itself. A page for Sidra can be built from OpenDeck's
Multi Actions instead:

- On the main profile, a Multi Action of **Launch App** (Sidra) and **Switch
  Profile** (`Sidra`) opens Sidra, or brings it forward, and shows the page.
- On a profile named `Sidra`, put the controls, a **Switch Profile**
  (`Default`) key as Back, and a Multi Action of **Close Sidra** and **Switch
  Profile** (`Default`) to quit Sidra and return in one press.

## Credits

`icons/plugin.png` is Sidra's application icon from
[wimpysworld/sidra](https://github.com/wimpysworld/sidra), licensed under the
[Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0). The
other icons were drawn for this plugin in Sidra's colours, apart from the red of
Mute's muted state.
