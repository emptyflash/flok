const { spawn, execSync } = require("child_process");
const EventEmitter = require("events");
const path = require("path");
const PubSubClient = require("../../../lib/pubsub-client");

class REPL {
  constructor(ctx) {
    const { command, target, hub, pubSubPath } = ctx;

    this.command = command;

    this.target = target || "default";
    this.hub = hub || "ws://localhost:3000";
    this.pubSubPath = pubSubPath || "/pubsub";

    this.emitter = new EventEmitter();

    this._connectToPubSubServer();

    this._buffers = { stdout: "", stderr: "" };
    this._lastUserName = null;
  }

  // eslint-disable-next-line class-methods-use-this
  start() {
    // Spawn process
    const parts = this.command.split(" ");

    const cmd = parts[0];
    const args = parts.slice(1);
    console.log(`Spawn ${cmd} with args ${args}`);
    this.repl = spawn(cmd, args, { shell: true });

    // Handle stdout and stderr
    this.repl.stdout.on("data", data => {
      this._handleData(data, "stdout");
    });

    this.repl.stderr.on("data", data => {
      this._handleData(data, "stderr");
    });

    this.repl.on("close", code => {
      console.log(`child process exited with code ${code}`);
    });

    // Subscribe to pub sub
    this.pubSub.subscribe(`target:${this.target}:in`, message => {
      const { body, userName } = message;
      this.write(body);
      this._lastUserName = userName;
    });
  }

  write(body) {
    const newBody = this.prepare(body);
    this.repl.stdin.write(`${newBody}\n`);
    console.log("stdin", newBody);
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(body) {
    return body.trim();
  }

  onData(callback) {
    this.onData = callback;
  }

  _connectToPubSubServer() {
    const wsUrl = `${this.hub}${this.pubSubPath}`;

    console.log(wsUrl);
    this.pubSub = new PubSubClient(wsUrl, {
      connect: true,
      reconnect: true
    });
  }

  _handleData(data, type) {
    console.log(type, data.toString());

    const newBuffer = this._buffers[type].concat(data.toString());
    const lines = newBuffer.split("\n");

    this._buffers[type] = lines.pop();

    this.emitter.emit("data", { type, lines });

    if (lines.length > 0) {
      this.pubSub.publish(`target:${this.target}:out`, {
        target: this.target,
        type,
        body: lines
      });
      if (this._lastUserName) {
        this.pubSub.publish(`user:${this._lastUserName}`, {
          target: this.target,
          type,
          body: lines
        });
      }
    }
  }
}

class TidalREPL extends REPL {
  constructor(ctx) {
    super({
      ...ctx,
      command: `${TidalREPL.commandPath(
        "ghci"
      )} -ghci-script ${TidalREPL.defaultBootScript()}`
    });
  }

  prepare(body) {
    let newBody = super.prepare(body);
    newBody = `:{\n${newBody}\n:}`;
    return newBody;
  }

  static defaultBootScript() {
    return path.join(TidalREPL.dataDir(), "BootTidal.hs");
  }

  static dataDir() {
    try {
      const dataDir = execSync(
        `${TidalREPL.commandPath("ghc-pkg")} field tidal data-dir`
      )
        .toString()
        .trim();

      return dataDir.substring(dataDir.indexOf(" ") + 1);
    } catch (err) {
      console.error(`Error get tidal data-dir: ${err}`);
      return "";
    }
  }

  static commandPath(cmd) {
    // TODO Make it work without stack (configuration setting)
    return `stack exec -- ${cmd}`;
  }
}

const replClasses = {
  default: REPL,
  tidal: TidalREPL
};

export function createREPLFor(repl, ctx) {
  if (replClasses[repl]) {
    return new replClasses[repl](ctx);
  }

  const replClass = replClasses.default;
  return new replClass({ ...ctx, command: repl });
}

export default REPL;