"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  formatProbability,
  HAPPENING_COPY,
  riskIncrement,
  rollHappening,
  type Happening,
} from "@/lib/game";
import { randomNickname } from "@/lib/nicknames";
import { getSupabase, multiplayerConfigured } from "@/lib/supabase";

type IconProps = { size?: number; className?: string };
const glyph = (character: string) => function Glyph({ size = 18, className }: IconProps) {
  return <span className={className} aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{character}</span>;
};
const ArrowLeft = glyph("←");
const Bomb = glyph("✹");
const Check = glyph("✓");
const Copy = glyph("▣");
const Crown = glyph("♛");
const Dice5 = glyph("⚄");
const Gamepad2 = glyph("⌘");
const Link2 = glyph("↗");
const LoaderCircle = glyph("◌");
const Lock = glyph("🔒");
const LogIn = glyph("↪");
const Play = glyph("▶");
const RotateCcw = glyph("↻");
const Share2 = glyph("◇");
const Sparkles = glyph("✦");
const Users = glyph("◎");
const Volume2 = glyph("♪");
const Zap = glyph("ϟ");

type Screen = "home" | "lobby" | "online" | "solo";

type RoomRecord = {
  id: string;
  code: string;
  host_player_id: string | null;
  status: "waiting" | "playing" | "finished";
  current_player_id: string | null;
  loser_player_id: string | null;
  total_pumps: number;
  risk_bps: number;
  turn_pumps: number;
  event_type: Happening;
  event_required_pumps: number;
  version: number;
};

type PlayerRecord = {
  id: string;
  room_id: string;
  nickname: string;
  seat: number;
  active: boolean;
};

type OnlineSession = {
  roomCode: string;
  playerId: string;
  token: string;
};

type GamePlayer = {
  id: string;
  nickname: string;
  isCpu?: boolean;
};

type SoloState = {
  status: "playing" | "finished";
  players: GamePlayer[];
  currentIndex: number;
  totalPumps: number;
  riskBps: number;
  turnPumps: number;
  eventType: Happening;
  eventRequired: number;
  loserId: string | null;
  revision: number;
};

type GameStageProps = {
  status: "playing" | "finished";
  players: GamePlayer[];
  currentPlayerId: string | null;
  myPlayerId: string;
  loserId: string | null;
  totalPumps: number;
  riskBps: number;
  turnPumps: number;
  eventType: Happening;
  eventRequired: number;
  busy: boolean;
  canRestart: boolean;
  onInflate: () => void;
  onPass: () => void;
  onRestart: () => void;
  onExit: () => void;
};

const ROOM_SELECT =
  "id,code,host_player_id,status,current_player_id,loser_player_id,total_pumps,risk_bps,turn_pumps,event_type,event_required_pumps,version";
const PLAYER_SELECT = "id,room_id,nickname,seat,active";

function createToken() {
  return crypto.randomUUID();
}

function playPumpSound() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const duration = 0.2;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const envelope = Math.sin((index / data.length) * Math.PI);
    data[index] = (Math.random() * 2 - 1) * envelope * 0.34;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(720, context.currentTime);
  filter.frequency.exponentialRampToValueAtTime(180, context.currentTime + duration);
  gain.gain.setValueAtTime(0.35, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  source.onended = () => void context.close();
}

function playExplosionSound() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const duration = 0.7;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 2);
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(900, context.currentTime);
  filter.frequency.exponentialRampToValueAtTime(90, context.currentTime + duration);
  gain.gain.setValueAtTime(0.75, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  source.onended = () => void context.close();
}

function nextSoloTurn(state: SoloState): SoloState {
  const event = rollHappening();
  return {
    ...state,
    currentIndex: (state.currentIndex + 1) % state.players.length,
    turnPumps: 0,
    eventType: event.type,
    eventRequired: event.requiredPumps,
    revision: state.revision + 1,
  };
}

function inflateSoloState(state: SoloState): SoloState {
  if (state.status !== "playing") return state;
  const totalPumps = state.totalPumps + 1;
  const riskBps = Math.min(
    10_000,
    state.riskBps + riskIncrement(totalPumps, state.eventType),
  );
  const turnPumps = state.turnPumps + 1;
  if (Math.random() < riskBps / 10_000) {
    return {
      ...state,
      status: "finished",
      totalPumps,
      riskBps,
      turnPumps,
      loserId: state.players[state.currentIndex].id,
      revision: state.revision + 1,
    };
  }
  const pumped = { ...state, totalPumps, riskBps, turnPumps, revision: state.revision + 1 };
  return state.eventType === "giant" ? nextSoloTurn(pumped) : pumped;
}

function GameStage({
  status,
  players,
  currentPlayerId,
  myPlayerId,
  loserId,
  totalPumps,
  riskBps,
  turnPumps,
  eventType,
  eventRequired,
  busy,
  canRestart,
  onInflate,
  onPass,
  onRestart,
  onExit,
}: GameStageProps) {
  const currentPlayer = players.find((player) => player.id === currentPlayerId);
  const loser = players.find((player) => player.id === loserId);
  const isMyTurn = status === "playing" && currentPlayerId === myPlayerId;
  const canPass = turnPumps >= eventRequired;
  const passEnabled = isMyTurn && canPass && eventType !== "giant" && !busy;
  const balloonSize = 178 + Math.min(totalPumps * 1.15, 205);
  const danger = Math.min(riskBps / 10_000, 1);

  return (
    <main className="game-shell">
      <div className="noise" aria-hidden="true" />
      <header className="game-topbar">
        <button className="icon-button" onClick={onExit} aria-label="ゲームを退出">
          <ArrowLeft size={19} />
        </button>
        <div className="turn-display">
          <span className="eyebrow">CURRENT TURN</span>
          <strong>{currentPlayer?.nickname ?? "判定中…"}</strong>
          {isMyTurn && <span className="your-turn-dot">あなたの番</span>}
        </div>
        <div className="sound-badge" title="効果音オン">
          <Volume2 size={17} />
        </div>
      </header>

      <div className="player-rail" aria-label="参加プレイヤー">
        {players.map((player, index) => (
          <div
            className={`player-chip ${player.id === currentPlayerId ? "active" : ""}`}
            key={player.id}
          >
            <span>{index + 1}</span>
            <strong>{player.nickname}</strong>
            {player.isCpu && <small>CPU</small>}
          </div>
        ))}
      </div>

      <section className="game-board">
        {eventType && status === "playing" && (
          <div className={`happening-banner ${eventType}`}>
            {eventType === "powerful" ? <Zap size={20} /> : eventType === "giant" ? <Bomb size={20} /> : <Sparkles size={20} />}
            <div>
              <span>HAPPENING!</span>
              <strong>{HAPPENING_COPY[eventType].title}</strong>
              <small>
                {eventType === "force"
                  ? `最低 ${eventRequired} 回。あと ${Math.max(eventRequired - turnPumps, 0)} 回！`
                  : HAPPENING_COPY[eventType].description}
              </small>
            </div>
          </div>
        )}

        <div className="balloon-zone" aria-live="polite">
          <div
            className={`balloon-wrap ${busy ? "pumping" : ""} ${status === "finished" ? "burst" : ""}`}
            style={{ width: balloonSize, height: balloonSize * 1.13 }}
          >
            <div
              className="balloon"
              style={{
                background: `linear-gradient(135deg, hsl(${344 - danger * 18} 92% ${66 - danger * 12}%), hsl(${326 - danger * 8} 86% ${44 - danger * 8}%))`,
              }}
            >
              <div className="balloon-shine" />
              <span className="balloon-count">{totalPumps}</span>
            </div>
            <div className="balloon-knot" />
            <div className="balloon-string" />
            {status === "finished" && (
              <div className="burst-pieces" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
              </div>
            )}
          </div>
        </div>

        <div className="risk-panel">
          <span>現在の爆発確率</span>
          <strong>{formatProbability(riskBps)}</strong>
          <div className="risk-meter"><i style={{ width: `${Math.max(2, danger * 100)}%` }} /></div>
        </div>

        {status === "playing" && (
          <div className="game-actions">
            <button
              className="inflate-button"
              disabled={!isMyTurn || busy}
              onClick={onInflate}
              data-testid="inflate-button"
            >
              {busy ? <LoaderCircle className="spin" size={23} /> : <span className="inflate-balloon-icon" aria-hidden="true" />}
              <strong>膨らませる</strong>
            </button>
            <button className="pass-button" disabled={!passEnabled} onClick={onPass}>
              {!passEnabled && <Lock size={15} />}
              <span className="pass-label">
                <strong>パスする</strong>
                {!passEnabled && (
                  <small>
                    {isMyTurn
                      ? `あと ${Math.max(eventRequired - turnPumps, 0)} 回膨らませる`
                      : "手番を待っています"}
                  </small>
                )}
              </span>
              {passEnabled && <span className="pass-arrow" aria-hidden="true">→</span>}
            </button>
          </div>
        )}
      </section>

      {status === "finished" && (
        <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="result-card">
            <span className="result-kicker">LIMIT BREAK</span>
            <div className="result-icon"><Bomb size={34} /></div>
            <h2 id="result-title">{loser?.nickname ?? "誰か"}が爆発させました！</h2>
            <p>風船を爆発させた人の負け！</p>
            <div className="result-stats">
              <div><span>最後の確率</span><strong>{formatProbability(riskBps)}</strong></div>
              <div><span>膨らませた回数</span><strong>{totalPumps}<small>回</small></strong></div>
            </div>
            <div className="result-actions">
              {canRestart && <button className="primary-button" onClick={onRestart}><RotateCcw size={18} />もう一度</button>}
              <button className="secondary-button" onClick={onExit}>トップへ戻る</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [nickname, setNickname] = useState<string>(() => randomNickname());
  const [joinCode, setJoinCode] = useState("");
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [solo, setSolo] = useState<SoloState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [homeQrDataUrl, setHomeQrDataUrl] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const explodedRevision = useRef<string>("");
  const roomId = room?.id;

  const loadRoom = useCallback(async (roomCode: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select(ROOM_SELECT)
      .eq("code", roomCode)
      .single();
    if (roomError) throw roomError;
    const typedRoom = roomData as unknown as RoomRecord;
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select(PLAYER_SELECT)
      .eq("room_id", typedRoom.id)
      .eq("active", true)
      .order("seat");
    if (playerError) throw playerError;
    setRoom(typedRoom);
    setPlayers((playerData ?? []) as unknown as PlayerRecord[]);
    setScreen(typedRoom.status === "waiting" ? "lobby" : "online");
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room");
    // URLの招待コードをフォームへ同期するための初期化です。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) setJoinCode(code.toUpperCase().slice(0, 6));
    const stored = localStorage.getItem("shikoshiko-session");
    if (!stored || !multiplayerConfigured) return;
    try {
      const restored = JSON.parse(stored) as OnlineSession;
      setSession(restored);
      void loadRoom(restored.roomCode).catch(() => localStorage.removeItem("shikoshiko-session"));
    } catch {
      localStorage.removeItem("shikoshiko-session");
    }
  }, [loadRoom]);

  useEffect(() => {
    if (!session || !roomId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(`room-${roomId}-${Date.now()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        const next = payload.new as RoomRecord;
        setRoom(next);
        setScreen(next.status === "waiting" ? "lobby" : "online");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => {
        void loadRoom(session.roomCode);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session, roomId, loadRoom]);

  useEffect(() => {
    if (screen !== "lobby" || !room) return;
    const shareUrl = `${window.location.origin}/?room=${room.code}`;
    void QRCode.toDataURL(shareUrl, {
      width: 360,
      margin: 2,
      color: { dark: "#17131f", light: "#fffdf7" },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl);
  }, [screen, room]);

  useEffect(() => {
    const onlineExplosion = room?.status === "finished" ? `online-${room.id}-${room.version}` : "";
    const soloExplosion = solo?.status === "finished" ? `solo-${solo.revision}` : "";
    const key = onlineExplosion || soloExplosion;
    if (key && explodedRevision.current !== key) {
      explodedRevision.current = key;
      playExplosionSound();
    }
  }, [room?.status, room?.version, room?.id, solo?.status, solo?.revision]);

  useEffect(() => {
    if (!solo || solo.status !== "playing") return;
    const current = solo.players[solo.currentIndex];
    if (!current.isCpu) return;
    const timer = window.setTimeout(() => {
      setSolo((state) => {
        if (!state || state.status !== "playing" || !state.players[state.currentIndex].isCpu) return state;
        const minimumMet = state.turnPumps >= state.eventRequired;
        const shouldPass = minimumMet && (state.turnPumps >= 7 || Math.random() < 0.4);
        if (shouldPass) return nextSoloTurn(state);
        playPumpSound();
        return inflateSoloState(state);
      });
    }, 520 + Math.random() * 680);
    return () => window.clearTimeout(timer);
  }, [solo]);

  const onlinePlayers = useMemo<GamePlayer[]>(
    () => players.map(({ id, nickname }) => ({ id, nickname })),
    [players],
  );

  async function createRoom() {
    const supabase = getSupabase();
    if (!supabase) {
      setError("マルチプレイにはSupabaseの接続設定が必要です。ソロプレイは今すぐ遊べます。");
      return;
    }
    setBusy(true);
    setError("");
    const token = createToken();
    const { data, error: rpcError } = await supabase.rpc("create_room", {
      p_nickname: nickname.trim() || randomNickname(),
      p_player_token: token,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    const result = (data as { room_code: string; player_id: string }[])[0];
    const nextSession = { roomCode: result.room_code, playerId: result.player_id, token };
    localStorage.setItem("shikoshiko-session", JSON.stringify(nextSession));
    setSession(nextSession);
    await loadRoom(result.room_code);
    setBusy(false);
  }

  async function joinRoom() {
    const supabase = getSupabase();
    if (!supabase) {
      setError("マルチプレイにはSupabaseの接続設定が必要です。ソロプレイは今すぐ遊べます。");
      return;
    }
    if (joinCode.length !== 6) {
      setError("6文字の部屋コードを入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    const token = createToken();
    const { data, error: rpcError } = await supabase.rpc("join_room", {
      p_room_code: joinCode.toUpperCase(),
      p_nickname: nickname.trim() || randomNickname(),
      p_player_token: token,
    });
    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    const result = (data as { room_code: string; player_id: string }[])[0];
    const nextSession = { roomCode: result.room_code, playerId: result.player_id, token };
    localStorage.setItem("shikoshiko-session", JSON.stringify(nextSession));
    setSession(nextSession);
    await loadRoom(result.room_code);
    setBusy(false);
  }

  async function onlineAction(action: "start_game" | "inflate_balloon" | "pass_turn" | "restart_game") {
    const supabase = getSupabase();
    if (!supabase || !session) return;
    setBusy(true);
    setError("");
    if (action === "inflate_balloon") playPumpSound();
    const { error: rpcError } = await supabase.rpc(action, {
      p_room_code: session.roomCode,
      p_player_token: session.token,
    });
    if (rpcError) setError(rpcError.message);
    await loadRoom(session.roomCode).catch(() => undefined);
    setBusy(false);
  }

  function startSolo() {
    const event = rollHappening();
    setSolo({
      status: "playing",
      players: [
        { id: "human", nickname: nickname.trim() || randomNickname() },
        { id: "cpu-1", nickname: "CPU・ちくわ", isCpu: true },
        { id: "cpu-2", nickname: "CPU・ぬるま湯", isCpu: true },
        { id: "cpu-3", nickname: "CPU・野次馬", isCpu: true },
      ],
      currentIndex: 0,
      totalPumps: 0,
      riskBps: 0,
      turnPumps: 0,
      eventType: event.type,
      eventRequired: event.requiredPumps,
      loserId: null,
      revision: 0,
    });
    setScreen("solo");
  }

  function exitGame() {
    setScreen("home");
    setRoom(null);
    setPlayers([]);
    setSession(null);
    setSolo(null);
    localStorage.removeItem("shikoshiko-session");
    window.history.replaceState({}, "", window.location.pathname);
  }

  async function copyInvite() {
    if (!room) return;
    await navigator.clipboard.writeText(`${window.location.origin}/?room=${room.code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function openHomeShare() {
    const shareUrl = `${window.location.origin}${window.location.pathname}`;
    const qrCode = await QRCode.toDataURL(shareUrl, {
      width: 320,
      margin: 2,
      color: { dark: "#17131f", light: "#fffdf7" },
      errorCorrectionLevel: "M",
    });
    setHomeQrDataUrl(qrCode);
    setShareOpen(true);
  }

  async function copyHomeLink() {
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  }

  if (screen === "lobby" && room && session) {
    const isHost = room.host_player_id === session.playerId;
    return (
      <main className="lobby-shell">
        <div className="noise" aria-hidden="true" />
        <button className="back-button" onClick={exitGame}><ArrowLeft size={18} />トップへ</button>
        <section className="lobby-card">
          <div className="lobby-copy">
            <span className="eyebrow">ROOM IS READY</span>
            <p>QRコードを読み取るか、部屋コードを送って参加してもらってください。</p>
            <div className="room-code-block">
              <span>部屋コード</span>
              <strong>{room.code}</strong>
              <button onClick={copyInvite}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "コピーしました" : "招待リンクをコピー"}</button>
            </div>
          </div>
          <div className="qr-card">
            {/* QRはdata URLなので画像最適化の対象外です。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qrDataUrl ? <img src={qrDataUrl} alt={`部屋 ${room.code} への参加QRコード`} /> : <LoaderCircle className="spin" />}
            <span><Link2 size={15} />スマホで読み取って参加</span>
          </div>
          <div className="lobby-players">
            <div className="section-heading"><div><span className="eyebrow">PLAYERS</span><h2>参加者</h2></div><strong>{players.length}<small>人</small></strong></div>
            <div className="waiting-list">
              {players.map((player) => (
                <div className="waiting-player" key={player.id}>
                  <span className="avatar">{player.nickname.slice(0, 1)}</span>
                  <strong>{player.nickname}</strong>
                  {player.id === room.host_player_id && <small><Crown size={13} />部屋主</small>}
                  {player.id === session.playerId && <em>あなた</em>}
                </div>
              ))}
              <div className="waiting-player empty"><span className="avatar">＋</span><strong>次の挑戦者を待っています…</strong></div>
            </div>
            {error && <p className="form-error">{error}</p>}
            {isHost ? (
              <button className="primary-button lobby-start" disabled={players.length < 2 || busy} onClick={() => void onlineAction("start_game")}>
                {busy ? <LoaderCircle className="spin" size={20} /> : <Play size={20} />}
                {players.length < 2 ? "あと1人参加すると開始できます" : "ゲームを開始する"}
              </button>
            ) : <div className="host-waiting"><LoaderCircle className="spin" size={17} />部屋主が開始するのを待っています</div>}
          </div>
        </section>
      </main>
    );
  }

  if (screen === "online" && room && session) {
    return (
      <GameStage
        status={room.status === "finished" ? "finished" : "playing"}
        players={onlinePlayers}
        currentPlayerId={room.current_player_id}
        myPlayerId={session.playerId}
        loserId={room.loser_player_id}
        totalPumps={room.total_pumps}
        riskBps={room.risk_bps}
        turnPumps={room.turn_pumps}
        eventType={room.event_type}
        eventRequired={room.event_required_pumps}
        busy={busy}
        canRestart={room.host_player_id === session.playerId}
        onInflate={() => void onlineAction("inflate_balloon")}
        onPass={() => void onlineAction("pass_turn")}
        onRestart={() => void onlineAction("restart_game")}
        onExit={exitGame}
      />
    );
  }

  if (screen === "solo" && solo) {
    return (
      <GameStage
        status={solo.status}
        players={solo.players}
        currentPlayerId={solo.players[solo.currentIndex]?.id ?? null}
        myPlayerId="human"
        loserId={solo.loserId}
        totalPumps={solo.totalPumps}
        riskBps={solo.riskBps}
        turnPumps={solo.turnPumps}
        eventType={solo.eventType}
        eventRequired={solo.eventRequired}
        busy={false}
        canRestart
        onInflate={() => { playPumpSound(); setSolo((state) => state ? inflateSoloState(state) : state); }}
        onPass={() => setSolo((state) => state ? nextSoloTurn(state) : state)}
        onRestart={startSolo}
        onExit={exitGame}
      />
    );
  }

  return (
    <main className="home-shell">
      <div className="noise" aria-hidden="true" />
      <nav className="home-nav">
        <div className="mini-logo"><span>◉</span>LIMIT PUMP</div>
        <div className="home-nav-actions">
          <div className="online-pill"><i />ONLINE / SOLO</div>
          <button className="share-button" onClick={() => void openHomeShare()}><Share2 size={16} />共有</button>
        </div>
      </nav>
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="kicker"><Sparkles size={15} />風船割りチキンレース</div>
          <h1>
            <span>何回でもシコシコ</span>
            <span>してよくて</span>
            <span>でも最低一回は</span>
            <span>シコってしなきゃ</span>
            <span>いけなくて</span>
            <span>限界に達した人が</span>
            <span>負けっていうゲーム</span>
          </h1>
        </div>
        <div className="setup-card">
          <label className="nickname-label">
            <span>ニックネーム</span>
            <div className="nickname-field">
              <input value={nickname} maxLength={18} onChange={(event) => setNickname(event.target.value)} aria-label="ニックネーム" />
              <button onClick={() => setNickname(randomNickname())} aria-label="ランダムな名前にする" title="ランダムな名前にする"><Dice5 size={22} /></button>
            </div>
          </label>
          <div className="mode-buttons">
            <button className="mode-card multiplayer" onClick={() => void createRoom()} disabled={busy}>
              <span className="mode-icon"><Users size={25} /></span>
              <span><small>MULTIPLAYER</small><strong>部屋をつくる</strong><em>近くの人とQRで参加</em></span>
              <span className="mode-arrow">→</span>
            </button>
            <button className="mode-card solo" onClick={startSolo}>
              <span className="mode-icon"><Gamepad2 size={25} /></span>
              <span><small>SOLO PLAY</small><strong>CPUと遊ぶ</strong><em>あなた＋CPU 3人</em></span>
              <span className="mode-arrow">→</span>
            </button>
          </div>
          <div className="join-divider"><span>または</span></div>
          <div className="join-row">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              placeholder="部屋コード 6文字"
              aria-label="部屋コード"
            />
            <button disabled={busy} onClick={() => void joinRoom()}><LogIn size={18} />参加</button>
          </div>
          {!multiplayerConfigured && <p className="setup-note"><Zap size={15} />マルチプレイはSupabase接続後に有効になります。ソロは今すぐ遊べます。</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
      <footer className="home-footer">
        <button onClick={() => setSupportOpen(true)}>不具合が発生したらここを押してください</button>
      </footer>

      {shareOpen && (
        <div className="home-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="share-title">
          <div className="home-modal-card share-modal-card">
            <button className="modal-close" onClick={() => setShareOpen(false)} aria-label="共有画面を閉じる">×</button>
            <span className="eyebrow">SHARE THIS GAME</span>
            <h2 id="share-title">QRコードでゲームを共有</h2>
            {/* QRはdata URLなので画像最適化の対象外です。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {homeQrDataUrl && <img src={homeQrDataUrl} alt="ゲームのトップページを開くQRコード" />}
            <button className="copy-home-link" onClick={() => void copyHomeLink()}>
              {shareCopied ? <Check size={17} /> : <Copy size={17} />}
              {shareCopied ? "コピーしました" : "ゲームのリンクをコピー"}
            </button>
          </div>
        </div>
      )}

      {supportOpen && (
        <div className="home-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="support-title">
          <div className="home-modal-card support-modal-card">
            <button className="modal-close" onClick={() => setSupportOpen(false)} aria-label="問い合わせ先を閉じる">×</button>
            <span className="eyebrow">BUG REPORT</span>
            <h2 id="support-title">不具合のご連絡先</h2>
            <a href="mailto:yommypixeldev@gmail.com">メール：yommypixeldev@gmail.com</a>
            <a href="https://www.instagram.com/umoy218/" target="_blank" rel="noreferrer">Instagram：@umoy218</a>
          </div>
        </div>
      )}
    </main>
  );
}
