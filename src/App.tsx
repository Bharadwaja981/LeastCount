/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, Component, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { 
  Users, 
  Trophy, 
  Settings, 
  Plus, 
  LogIn, 
  LogOut,
  Play, 
  Hand, 
  ArrowRight,
  AlertCircle,
  History,
  BarChart3,
  ChevronRight,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Eye,
  Gamepad2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User as UserIcon,
  Layout,
  Send,
  Calendar,
  Award,
  CheckCircle2,
  X,
  XCircle,
  Smile
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Howl } from "howler";
import { 
  supabase,
  signInWithGoogle, 
  logout, 
  createUserProfile, 
  updateStatsAfterGame, 
  saveMatchHistory, 
  getLeaderboard, 
  getRecentMatches,
  getUserRank,
  updateUserStatus,
  unlockAchievement,
  updateDailyChallenges,
  followUser,
  unfollowUser,
  getFollowingProfiles,
  UserProfile,
  MatchHistory
} from "./supabase";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Sounds
const sounds = {
  click: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3"] }),
  draw: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2012/2012-preview.mp3"] }),
  discard: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3"] }),
  win: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3"] }),
  lose: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3"] }),
  error: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3"] }),
  turnStart: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3"] }),
  tick: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3"], volume: 0.5 }),
  timeout: new Howl({ src: ["https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3"] }),
};

// Types
interface Card {
  suit: "hearts" | "diamonds" | "clubs" | "spades";
  rank: string;
  value: number;
}

interface Player {
  id: string; // Persistent ID
  socketId: string; // Current socket ID
  uid?: string;
  name: string;
  hand: Card[];
  score: number;
  isHost: boolean;
  isEliminated: boolean;
  isBot?: boolean;
  isAway?: boolean;
}

interface Spectator {
  id: string;
  socketId: string;
  name: string;
}

interface RoomConfig {
  maxPlayers: number;
  callLimit: number;
  eliminationLimit: number;
  penaltyValue: number;
  turnTimeLimit: number;
  isTimerEnabled: boolean;
  botDifficulty: "easy" | "normal" | "hard";
  allowSpectators: boolean;
}

interface RoundScore {
  roundNumber: number;
  scores: { [playerId: string]: number };
  eliminatedPlayers: string[];
}

interface GameState {
  deck: Card[];
  discardPile: Card[];
  currentTurnDiscard: Card[];
  turnIndex: number;
  turnPhase: "discarding" | "drawing";
  status: "lobby" | "playing" | "round_end" | "game_over";
  lastAction?: string;
  winner?: string;
  roundHistory: RoundScore[];
  joker?: Card;
  nextRoundCountdown?: number;
  turnEndTime?: number;
  startingPlayerIndex: number;
}

interface Room {
  id: string;
  players: Player[];
  spectators: Spectator[];
  config: RoomConfig;
  gameState: GameState;
}

const SUIT_ICONS = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
  joker: "🃏",
};

const SUIT_COLORS = {
  hearts: "text-red-600",
  diamonds: "text-red-600",
  clubs: "text-gray-900 dark:text-slate-200",
  spades: "text-gray-900 dark:text-slate-200",
  joker: "text-indigo-600",
};

// Components
interface CardComponentProps {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  isMatch?: boolean;
  isWildJoker?: boolean;
  className?: string;
}

const CardComponent: React.FC<CardComponentProps> = ({ 
  card, 
  selected, 
  onClick, 
  disabled,
  hidden,
  isMatch,
  className,
  isWildJoker
}) => {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  if (hidden) {
    return (
      <div className={cn("w-14 h-20 sm:w-20 sm:h-32 bg-white dark:bg-slate-800 rounded-lg border-2 border-indigo-200 dark:border-indigo-900 flex items-center justify-center shadow-lg select-none", className)}>
        <div className="w-10 h-16 sm:w-16 sm:h-28 border border-indigo-100 dark:border-indigo-950 rounded-md flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/30">
          <div className="text-indigo-400 dark:text-indigo-600 font-black text-xl sm:text-2xl italic opacity-50">LC</div>
        </div>
      </div>
    );
  }

  const isActualJoker = card.rank === "Joker";
  const showJokerBadge = isActualJoker || isWildJoker;

  return (
    <motion.div
      whileHover={!disabled && !isMobile ? { y: -10 } : {}}
      onClick={!disabled ? onClick : undefined}
      className={cn(
        "w-14 h-20 sm:w-20 sm:h-32 bg-white dark:bg-slate-800 rounded-lg border-2 flex flex-col p-1 sm:p-2 cursor-pointer select-none shadow-lg relative transition-all",
        selected ? "border-indigo-500 -translate-y-4 ring-4 ring-indigo-50 dark:ring-indigo-900/30" : "border-gray-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800",
        disabled && "opacity-50 cursor-not-allowed",
        showJokerBadge && "bg-amber-50 dark:bg-amber-950/20 border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20",
        className
      )}
    >
      <div className={cn("text-sm sm:text-lg font-bold leading-none select-none", SUIT_COLORS[card.suit], (card.suit === 'clubs' || card.suit === 'spades') && !showJokerBadge ? 'dark:text-slate-200' : '', showJokerBadge ? 'text-amber-600 dark:text-amber-400' : '')}>
        {isActualJoker ? "J" : card.rank}
      </div>
      <div className={cn("text-base sm:text-xl self-center my-auto select-none", SUIT_COLORS[card.suit], (card.suit === 'clubs' || card.suit === 'spades') && !showJokerBadge ? 'dark:text-slate-200' : '', showJokerBadge ? 'text-amber-600 dark:text-amber-400' : '')}>
        {isActualJoker ? "🃏" : SUIT_ICONS[card.suit]}
      </div>
      <div className={cn("text-sm sm:text-lg font-bold leading-none self-end rotate-180 select-none", SUIT_COLORS[card.suit], (card.suit === 'clubs' || card.suit === 'spades') && !showJokerBadge ? 'dark:text-slate-200' : '', showJokerBadge ? 'text-amber-600 dark:text-amber-400' : '')}>
        {isActualJoker ? "J" : card.rank}
      </div>
      
      {isMatch && (
        <div className="absolute -top-2.5 -right-2.5 bg-emerald-500 text-white text-[7px] sm:text-[9px] font-black px-2 py-0.5 rounded-full shadow-lg border border-white dark:border-slate-800 uppercase tracking-tighter z-20">
          Match
        </div>
      )}

      {showJokerBadge && (
        <div className="absolute -bottom-2 -left-1 bg-amber-500 text-white text-[7px] sm:text-[9px] font-black px-2 py-0.5 rounded-full shadow-lg border border-white dark:border-slate-800 uppercase tracking-tighter z-20">
          Joker
        </div>
      )}
    </motion.div>
  );
};

const RoundHistoryTable: React.FC<{ room: Room }> = ({ room }) => {
  return (
    <div className="w-full overflow-x-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm scrollbar-hide">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th className="px-2 sm:px-4 py-3 font-bold">Round</th>
            {room.players.map(p => (
              <th key={p.id} className="px-2 sm:px-4 py-3 font-bold truncate max-w-[60px] sm:max-w-[100px]">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {room.gameState.roundHistory.map((round) => (
            <tr key={round.roundNumber} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
              <td className="px-2 sm:px-4 py-3 font-medium text-slate-400 dark:text-slate-500">#{round.roundNumber}</td>
              {room.players.map(p => (
                <td key={p.id} className={cn(
                  "px-2 sm:px-4 py-3 font-mono text-xs sm:text-sm",
                  round.scores[p.id] === 0 ? "text-emerald-500 font-bold" : "text-slate-600 dark:text-slate-400"
                )}>
                  {round.scores[p.id]}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-indigo-50 dark:bg-indigo-900/20 font-bold">
            <td className="px-2 sm:px-4 py-3 text-indigo-500 dark:text-indigo-400">Total</td>
            {room.players.map(p => (
              <td key={p.id} className="px-2 sm:px-4 py-3 text-indigo-500 dark:text-indigo-400 font-mono text-xs sm:text-sm">
                {p.score}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} (${parsedError.operationType} on ${parsedError.path})`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || String(this.state.error);
      }

      return (
        <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4 transition-colors duration-300">
          <div className="max-w-md w-full bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <h2 className="text-2xl font-black text-red-600 dark:text-red-400 uppercase italic">Application Error</h2>
            <p className="text-red-500 dark:text-red-400/80 text-sm font-medium">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-red-500 text-white px-6 py-2 rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerId] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("lc_player_id");
      if (saved) return saved;
      const newId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("lc_player_id", newId);
      return newId;
    }
    return "";
  });
  const [room, setRoom] = useState<Room | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(() => {
    if (typeof window !== "undefined") {
      return !!localStorage.getItem("lc_current_room");
    }
    return false;
  });
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [tableSize, setTableSize] = useState({ width: 0, height: 0 });
  const tableRef = useRef<HTMLDivElement>(null);

  // Resize observer for table
  useEffect(() => {
    if (!tableRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [room?.gameState.status]);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);
  const [recentMatches, setRecentMatches] = useState<MatchHistory[]>([]);
  const [activeView, setActiveView] = useState<"home" | "profile" | "leaderboard">("home");
  const [profileTab, setProfileTab] = useState<'challenges' | 'achievements' | 'following' | 'history'>('challenges');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [activeRoundTabs, setActiveRoundTabs] = useState<Record<string, number>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true); // Default to true to avoid flicker
  const [showDisconnectOverlay, setShowDisconnectOverlay] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("lc_theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    if (theme === "dark") {
      root.classList.add("dark");
      body.classList.add("dark");
      root.setAttribute("data-theme", "dark");
      root.style.setProperty("color-scheme", "dark");
    } else {
      root.classList.remove("dark");
      body.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      root.style.setProperty("color-scheme", "light");
    }
    localStorage.setItem("lc_theme", theme);
  }, [theme]);

  const playSound = useCallback((soundName: keyof typeof sounds) => {
    if (!isMuted) sounds[soundName].play();
  }, [isMuted]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === "light" ? "dark" : "light");
    playSound("click");
  }, [playSound]);

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setLoadingProfile(true);
      try {
        const userProfile = await createUserProfile(session.user);
        setProfile(userProfile);
        setName(userProfile.displayName || "");
        const [rm, rk, fp] = await Promise.all([
          getRecentMatches(session.user.id),
          getUserRank(userProfile.wins, userProfile.gamesPlayed),
          getFollowingProfiles(userProfile.following || [])
        ]);
        setRecentMatches(rm);
        setRank(rk);
        setFollowingProfiles(fp);
      } catch (err: any) {
        console.error("Error refreshing profile:", err);
        setError(`Profile Error: ${err.message || JSON.stringify(err)}`);
      } finally {
        setLoadingProfile(false);
      }
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoadingLeaderboard(true);
      const lb = await getLeaderboard();
      setLeaderboard(lb);
    } catch (err) {
      console.error("Error fetching leaderboard:", err);
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user || null;
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const userProfile = await createUserProfile(currentUser);
          setProfile(userProfile);
          setName(userProfile.displayName || "");
          
          const [rm, rk, fp] = await Promise.all([
            getRecentMatches(currentUser.id),
            getUserRank(userProfile.wins, userProfile.gamesPlayed),
            getFollowingProfiles(userProfile.following || [])
          ]);
          
          setRecentMatches(rm);
          setRank(rk);
          setFollowingProfiles(fp);
        } catch (err: any) {
          console.error("Error setting up user profile:", err);
          setError(`Profile Error: ${err.message || JSON.stringify(err)}`);
        }
      } else {
        setProfile(null);
        setName(localStorage.getItem("lc_player_name") || "");
      }
    });

    // Real-time leaderboard listener
    const channel = supabase.channel('public:users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
        const lb = await getLeaderboard();
        setLeaderboard(lb);
      })
      .subscribe();

    // Initial fetch
    getLeaderboard().then(lb => {
      setLeaderboard(lb);
      setLoadingLeaderboard(false);
    }).catch(err => {
      console.error("Error fetching leaderboard:", err);
      setLoadingLeaderboard(false);
    });

    return () => {
      authListener.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (name && !user) {
      localStorage.setItem("lc_player_name", name);
    }
  }, [name, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.location.pathname === '/auth/callback') {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        }
      });

      const timer = setTimeout(() => {
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      }, 2500);

      return () => {
        subscription.unsubscribe();
        clearTimeout(timer);
      };
    }

    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await refreshProfile();
        } else {
          // If getSession didn't catch it immediately, wait a moment and try again
          setTimeout(async () => {
            await supabase.auth.getSession();
            await refreshProfile();
          }, 1000);
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshProfile]);

  const handleLogin = async () => {
    try {
      playSound("click");
      const popup = window.open('', 'oauth_popup', 'width=600,height=700');
      const url = await signInWithGoogle();
      if (url && popup) {
        popup.location.href = url;
      } else if (popup) {
        popup.close();
      }
    } catch (err) {
      playSound("error");
      setError("Login failed");
    }
  };

  const handleLogout = async () => {
    try {
      playSound("click");
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setUser(null);
      setProfile(null);
      setName(localStorage.getItem("lc_player_name") || "");
      setActiveView("home");
    }
  };

  const openLeaderboard = () => {
    fetchLeaderboard();
    setActiveView("leaderboard");
  };

  const openStats = async () => {
    setActiveView("profile");
    if (user) {
      try {
        const [rm, rk, fp] = await Promise.all([
          getRecentMatches(user.uid),
          getUserRank(profile?.wins || 0, profile?.gamesPlayed || 0),
          profile?.following ? getFollowingProfiles(profile.following) : Promise.resolve([])
        ]);
        setRecentMatches(rm);
        setRank(rk);
        setFollowingProfiles(fp);
        
        // Update status to online
        updateUserStatus(user.uid, 'online');
      } catch (err) {
        console.error("Error fetching stats:", err);
      }
    }
  };

  const handleFollow = async (targetUid: string) => {
    if (!user) return;
    await followUser(user.uid, targetUid);
    fetchLeaderboard(); // Refresh to show updated state
    
    // Update local profile state to avoid staleness
    if (profile) {
      const newFollowing = [...(profile.following || []), targetUid];
      setProfile({ ...profile, following: newFollowing });
      const fp = await getFollowingProfiles(newFollowing);
      setFollowingProfiles(fp);
    }
  };

  const handleUnfollow = async (targetUid: string) => {
    if (!user) return;
    await unfollowUser(user.uid, targetUid);
    fetchLeaderboard();
    
    // Update local profile state to avoid staleness
    if (profile && profile.following) {
      const newFollowing = profile.following.filter(id => id !== targetUid);
      setProfile({ ...profile, following: newFollowing });
      const fp = await getFollowingProfiles(newFollowing);
      setFollowingProfiles(fp);
    }
  };

  const sendEmoji = (emoji: string) => {
    if (room && socket) {
      socket.emit("SEND_EMOJI", { roomId: room.id, emoji, playerId });
    }
  };

  const exitGame = () => {
    playSound("click");
    socket?.emit("EXIT_ROOM", room?.id);
    localStorage.removeItem("lc_current_room");
    window.location.href = "/";
  };
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [activeEmojis, setActiveEmojis] = useState<{ [playerId: string]: { emoji: string; timestamp: number } }>({});
  const [showEmojis, setShowEmojis] = useState(true);
  const [followingProfiles, setFollowingProfiles] = useState<UserProfile[]>([]);
  const [friendStatus, setFriendStatus] = useState<{ [uid: string]: 'online' | 'offline' | 'in-game' }>({});
  const [config, setConfig] = useState<RoomConfig>({
    maxPlayers: 4,
    callLimit: 7,
    eliminationLimit: 100,
    penaltyValue: 50,
    turnTimeLimit: 30,
    isTimerEnabled: true,
    botDifficulty: "normal",
    allowSpectators: true,
  });

  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || undefined;
    const newSocket = io(backendUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      setShowDisconnectOverlay(false);
      console.log("[Client] Socket connected:", newSocket.id);
      // Attempt reconnection if we have a room ID
      const savedRoomId = localStorage.getItem("lc_current_room");
      if (savedRoomId && playerId) {
        console.log(`[Client] Attempting reconnection to room ${savedRoomId} with player ${playerId}`);
        setIsReconnecting(true);
        newSocket.emit("RECONNECT", { roomId: savedRoomId, playerId });
      }
    });
    newSocket.on("connect_error", () => {
      setIsConnected(false);
      setIsReconnecting(false);
    });
    newSocket.on("disconnect", (reason) => {
      setIsConnected(false);
      console.log("[Client] Socket disconnected:", reason);
      // Don't clear isReconnecting here, wait for connect or connect_error
    });

    // Check for room ID in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get("room");
    if (roomParam) {
      setRoomIdInput(roomParam.toUpperCase());
    }

    newSocket.on("ROOM_CREATED", (room: Room) => {
      setRoom(room);
      setIsReconnecting(false);
      localStorage.setItem("lc_current_room", room.id);
    });
    newSocket.on("ROOM_UPDATED", (room: Room) => {
      console.log("[Client] Room updated:", room.id);
      setRoom(room);
      setIsReconnecting(false);
      localStorage.setItem("lc_current_room", room.id);
    });

    newSocket.on("EMOJI_RECEIVED", ({ playerId, emoji }: { playerId: string; emoji: string }) => {
      setActiveEmojis(prev => ({
        ...prev,
        [playerId]: { emoji, timestamp: Date.now() }
      }));
      playSound("click");
      setTimeout(() => {
        setActiveEmojis(prev => {
          const newState = { ...prev };
          delete newState[playerId];
          return newState;
        });
      }, 3000);
    });

    newSocket.on("FRIEND_STATUS_UPDATE", ({ uid, status }: { uid: string; status: 'online' | 'offline' | 'in-game' }) => {
      setFriendStatus(prev => ({ ...prev, [uid]: status }));
    });

    newSocket.on("ROUND_OVER_STATS", async (stats: any) => {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user;
      if (!currentUser) return;
      const myStats = stats.players.find((p: any) => p.uid === currentUser.id);
      if (!myStats) return;

      // Check for "Clean Sweep" (winning a round with 0 points)
      if (stats.roundScores[myStats.id] === 0 && (stats.declarerId === myStats.id || stats.caughtById === myStats.id)) {
        await unlockAchievement(currentUser.id, 'clean_sweep');
        await updateDailyChallenges(currentUser.id, 'clean_sweep');
        refreshProfile();
      }

      // Check for "Comeback King" (winning after being at 90+ points)
      if (myStats.score >= 90 && stats.roundScores[myStats.id] === 0) {
        await unlockAchievement(currentUser.id, 'comeback_king');
        refreshProfile();
      }

      // Check for "Joker Master" (winning a round with a Joker in hand)
      const hasJoker = myStats.hand.some((c: any) => c.rank === 'Joker');
      if (hasJoker && stats.roundScores[myStats.id] === 0) {
        await unlockAchievement(currentUser.id, 'joker_master');
        await updateDailyChallenges(currentUser.id, 'win_with_joker');
        refreshProfile();
      }
    });

    newSocket.on("GAME_OVER_STATS", async (stats: any) => {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user;
      if (!currentUser) return;
      const isWinner = stats.winnerUid === currentUser.id;
      
      // Update Daily Challenges - Games Played
      await updateDailyChallenges(currentUser.id, 'games_played');

      // Check for "First Win"
      if (isWinner) {
        await unlockAchievement(currentUser.id, 'first_win');
        refreshProfile();
      }
    });

    newSocket.on("GAME_STARTED", (room: Room) => {
      setRoom(room);
      setIsReconnecting(false);
      localStorage.setItem("lc_current_room", room.id);
      playSound("click");
    });
    newSocket.on("ERROR", (msg: string) => {
      setError(msg);
      setIsReconnecting(false);
      if (msg === "Room not found" || msg === "Player not found in room") {
        localStorage.removeItem("lc_current_room");
      }
      playSound("error");
    });
    newSocket.on("ROUND_ENDED", async ({ room }: { room: Room }) => {
      setRoom(room);
      if (room.gameState.status === "game_over") {
        const me = room.players.find(p => p.id === playerId);
        const isWinner = room.gameState.winner === me?.name;
        playSound(isWinner ? "win" : "lose");
        
        // Save stats if logged in
        const { data: { session } } = await supabase.auth.getSession();
        const currentUser = session?.user;
        if (currentUser) {
          const playerMap = room.players.reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {} as Record<string, string>);
          const mappedRoundHistory = room.gameState.roundHistory.map(round => ({
            roundNumber: round.roundNumber,
            scores: Object.entries(round.scores).reduce((acc, [pid, score]) => {
              const name = playerMap[pid] || pid;
              return { ...acc, [name]: score };
            }, {} as Record<string, number>),
            eliminatedPlayers: round.eliminatedPlayers?.map(pid => playerMap[pid] || pid) || []
          }));

          const matchData = {
            matchId: room.id + "_" + room.gameState.roundHistory.length, // Deterministic ID to avoid duplicates
            players: room.players.map(p => p.name),
            playerUids: room.players.map(p => p.uid || p.id),
            winner: room.gameState.winner || "Unknown",
            scores: room.players.reduce((acc, p) => ({ ...acc, [p.name]: p.score }), {}),
            roundHistory: mappedRoundHistory,
            timestamp: null as any, // Server timestamp
            participants: room.players.map(p => p.uid || p.id), // Use UID if available, fallback to socket ID
          };

          Promise.all([
            updateStatsAfterGame(currentUser.id, isWinner),
            saveMatchHistory(matchData)
          ]).then(() => {
            refreshProfile();
            fetchLeaderboard();
          }).catch(err => {
            console.error("Error updating stats/history:", err);
            // Still refresh even if one fails
            refreshProfile();
            fetchLeaderboard();
          });
        }
      }
    });
    newSocket.on("ERROR", (msg: string) => {
      setError(msg);
      playSound("error");
    });
    newSocket.on("CARD_PLAYED", () => playSound("discard"));
    newSocket.on("CARD_DRAWN", () => playSound("draw"));

    return () => {
      newSocket.close();
    };
  }, []);

  const createRoom = async () => {
    if (!name) return setError("Enter your name");
    const { data: { session } } = await supabase.auth.getSession();
    socket?.emit("CREATE_ROOM", { name, config, uid: session?.user?.id, playerId });
  };

  const updateConfig = (newConfig: RoomConfig) => {
    if (!room) return;
    socket?.emit("UPDATE_CONFIG", { roomId: room.id, config: newConfig });
  };

  const addBot = () => {
    if (!room) return;
    socket?.emit("ADD_BOT", room.id);
  };

  const removeBot = (botId: string) => {
    if (!room) return;
    socket?.emit("REMOVE_BOT", { roomId: room.id, botId });
  };

  const joinRoom = async () => {
    const cleanId = roomIdInput.trim().toUpperCase();
    if (!name || !cleanId) return setError("Enter your name and room ID");
    const { data: { session } } = await supabase.auth.getSession();
    socket?.emit("JOIN_ROOM", { roomId: cleanId, name, uid: session?.user?.id, playerId });
  };

  const startGame = () => {
    if (room) socket?.emit("START_GAME", room.id);
  };

  const backToGame = () => {
    if (!room) return;
    socket?.emit("BACK_TO_GAME", { roomId: room.id, playerId });
    playSound("click");
  };

  const handleCardClick = (card: Card) => {
    if (isSpectator) return;
    
    // Allow selecting cards during discarding phase
    if (isMyTurn && myTurnPhase === "discarding") {
      const isSelected = selectedCards.find(c => c.suit === card.suit && c.rank === card.rank);
      if (isSelected) {
        setSelectedCards(selectedCards.filter(c => c.suit !== card.suit || c.rank !== card.rank));
      } else {
        setSelectedCards([...selectedCards, card]);
      }
    }
  };

  const discardCards = () => {
    if (isSpectator || selectedCards.length === 0) return;
    
    if (myTurnPhase === "discarding") {
      socket?.emit("CARD_ACTION", { 
        roomId: room?.id, 
        action: "discard", 
        cards: selectedCards 
      });
    }
    setSelectedCards([]);
  };

  const drawFromDeck = () => {
    if (isSpectator) return;
    socket?.emit("CARD_ACTION", { 
      roomId: room?.id, 
      action: "draw", 
      source: "deck" 
    });
  };

  const drawFromDiscard = () => {
    if (isSpectator) return;
    socket?.emit("CARD_ACTION", { 
      roomId: room?.id, 
      action: "draw", 
      source: "discard" 
    });
  };

  const declareLeastCount = () => {
    if (isSpectator) return;
    socket?.emit("DECLARE_LEAST_COUNT", room?.id);
  };

  useEffect(() => {
    if (user && socket) {
      const status = room ? 'in-game' : 'online';
      socket.emit("USER_STATUS", { uid: user.uid, status });
    }
  }, [user, socket, room?.id]);

  useEffect(() => {
    if (user) {
      updateUserStatus(user.uid, room ? 'in-game' : 'online');
    }
  }, [user, room?.id]);

  const [copied, setCopied] = useState(false);

  const copyInviteLink = () => {
    let origin = window.location.origin;
    // Automatically convert dev URL to shared URL for friends
    if (origin.includes("ais-dev-")) {
      origin = origin.replace("ais-dev-", "ais-pre-");
    }
    
    const inviteUrl = `${origin}${window.location.pathname}?room=${room?.id}`;
    navigator.clipboard.writeText(inviteUrl);
    
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getHandScore = (hand: Card[], joker?: Card) => {
    return hand.reduce((sum, card) => {
      if (card.suit === "joker" as any) return sum;
      if (joker && card.rank === joker.rank) return sum;
      return sum + card.value;
    }, 0);
  };

  const me = room?.players.find(p => p.id === playerId);
  const spectatorMe = room?.spectators.find(s => s.id === playerId);
  const isSpectator = !!spectatorMe;
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (room?.gameState.status === "playing" && room.gameState.turnEndTime) {
      const interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.max(0, Math.floor((room.gameState.turnEndTime! - now) / 1000));
        
        // If it was positive and now it's 0, play timeout sound
        if (timeLeft !== null && timeLeft > 0 && diff === 0) {
          playSound("timeout");
        }
        
        setTimeLeft(diff);
        
        if (diff <= 5 && diff > 0) {
          playSound("tick");
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setTimeLeft(null);
    }
  }, [room?.gameState.turnEndTime, room?.gameState.status, room?.gameState.turnIndex, playerId, playSound, timeLeft]);

  const isMyTurn = room?.gameState.status === "playing" && room.players[room.gameState.turnIndex]?.id === playerId;
  const myTurnPhase = isMyTurn ? room?.gameState.turnPhase : null;

  useEffect(() => {
    if (isMyTurn && (room?.gameState.turnPhase === "discarding" || room?.gameState.turnPhase === "drawing")) {
      playSound("turnStart");
    }
  }, [isMyTurn, room?.gameState.turnPhase, playSound]);
  const opponents = room?.players.filter(p => p.id !== playerId) || [];

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isConnected) {
      timer = setTimeout(() => {
        setShowDisconnectOverlay(true);
      }, 3000);
    } else {
      setShowDisconnectOverlay(false);
    }
    return () => clearTimeout(timer);
  }, [isConnected]);

  if (typeof window !== 'undefined' && window.location.pathname === '/auth/callback') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium animate-pulse">Completing login...</p>
        </div>
      </div>
    );
  }

  if (isReconnecting) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium animate-pulse">Reconnecting to your game...</p>
        </div>
      </div>
    );
  }

  if (!room) {
    if (activeView === "profile") {
      const uniqueMatches = Array.from(new Map(recentMatches.map(m => [m.matchId, m])).values());
      
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 font-sans transition-colors duration-300">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setActiveView("home")}
                className="flex items-center gap-2 text-slate-500 hover:text-indigo-500 font-bold transition-colors"
              >
                <ArrowRight className="rotate-180" size={20} />
                Back to Lobby
              </button>
              <div className="flex items-center gap-4">
                <button onClick={toggleTheme} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors">
                  {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
                </button>
                {user && (
                  <button onClick={handleLogout} className="flex items-center gap-2 text-red-500 font-bold hover:bg-red-50 dark:hover:bg-red-950/20 px-4 py-2 rounded-xl transition-all">
                    <LogOut size={18} />
                    Logout
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[1.5rem] sm:rounded-[2.5rem] p-4 sm:p-12 shadow-2xl border border-slate-200 dark:border-slate-800">
              {!user ? (
                <div className="text-center space-y-4 sm:space-y-6 py-6 sm:py-12">
                  <div className="w-12 h-12 sm:w-20 sm:h-20 bg-slate-100 dark:bg-slate-800 rounded-xl sm:rounded-3xl flex items-center justify-center mx-auto text-slate-400">
                    <UserIcon size={24} className="sm:w-8 sm:h-8" />
                  </div>
                  <h2 className="text-xl sm:text-3xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">Profile</h2>
                  <p className="text-slate-500 dark:text-slate-400 max-w-[240px] sm:max-w-xs mx-auto text-[10px] sm:text-base">Sign in to track your wins, losses, and compete on the global leaderboard.</p>
                  <button 
                    onClick={handleLogin}
                    className="bg-indigo-500 hover:bg-indigo-400 text-white px-5 py-2.5 sm:px-8 sm:py-4 rounded-lg sm:rounded-2xl font-black uppercase italic transition-all shadow-xl shadow-indigo-500/20 flex items-center gap-2 sm:gap-3 mx-auto text-xs sm:text-base"
                  >
                    <LogIn size={14} className="sm:w-[18px] sm:h-[18px]" />
                    Sign in with Google
                  </button>
                </div>
              ) : (
                <div className="space-y-8 sm:space-y-12">
                  <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
                    <div className="relative">
                      <img src={user.photoURL || ""} alt="" className="w-20 h-20 sm:w-32 sm:h-32 rounded-[1.5rem] sm:rounded-[2.5rem] border-2 sm:border-4 border-white dark:border-slate-800 shadow-2xl" />
                      <div className="absolute -bottom-1 -right-1 sm:-bottom-2 sm:-right-2 bg-indigo-500 text-white p-1 sm:p-2 rounded-lg sm:rounded-xl shadow-lg">
                        <Trophy size={12} className="sm:w-5 sm:h-5" />
                      </div>
                    </div>
                    <div className="text-center sm:text-left space-y-0.5 sm:space-y-2">
                      <h2 className="text-xl sm:text-4xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-none">
                        {profile?.displayName || user.user_metadata?.full_name || user.user_metadata?.name || 'Anonymous'}
                      </h2>
                      <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-[8px] sm:text-xs">{user.email}</p>
                      <div className="flex flex-wrap justify-center sm:justify-start gap-1.5 sm:gap-3 mt-2 sm:mt-4">
                        <div className="bg-indigo-500/10 text-indigo-500 px-2.5 py-0.5 sm:px-4 sm:py-1.5 rounded-full text-[7px] sm:text-[10px] font-black uppercase tracking-widest border border-indigo-500/20">
                          Rank #{rank || "?"}
                        </div>
                        <div className="bg-emerald-500/10 text-emerald-500 px-2.5 py-0.5 sm:px-4 sm:py-1.5 rounded-full text-[7px] sm:text-[10px] font-black uppercase tracking-widest border border-emerald-500/20">
                          Level {Math.floor((profile?.wins || 0) / 5) + 1}
                        </div>
                      </div>
                    </div>
                  </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                      {[
                        { label: "Played", value: profile?.gamesPlayed || 0, color: "text-slate-900 dark:text-white" },
                        { label: "Wins", value: profile?.wins || 0, color: "text-emerald-500" },
                        { label: "Losses", value: profile?.losses || 0, color: "text-red-500" },
                        { label: "Win Rate", value: profile?.gamesPlayed ? Math.round((profile.wins / profile.gamesPlayed) * 100) + "%" : "0%", color: "text-indigo-500" },
                      ].map((stat, i) => (
                        <div key={i} className="bg-slate-50 dark:bg-slate-800/50 p-3 sm:p-6 rounded-xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 text-center space-y-0 sm:space-y-1">
                          <div className={cn("text-lg sm:text-3xl font-black italic leading-none", stat.color)}>{stat.value}</div>
                          <div className="text-[7px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Profile Tabs */}
                    <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-x-auto scrollbar-hide">
                      {[
                        { id: 'challenges', label: 'Challenges', icon: Calendar },
                        { id: 'achievements', label: 'Achievements', icon: Award },
                        { id: 'following', label: 'Following', icon: Users },
                        { id: 'history', label: 'History', icon: History },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setProfileTab(tab.id as any)}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-[10px] sm:text-sm transition-all whitespace-nowrap",
                            profileTab === tab.id 
                              ? "bg-white dark:bg-slate-700 text-indigo-500 shadow-sm" 
                              : "text-slate-500 hover:text-indigo-500"
                          )}
                        >
                          <tab.icon size={16} />
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-8">
                      {profileTab === 'challenges' && (
                        <div className="space-y-4 sm:space-y-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 sm:gap-3">
                              <Calendar className="text-indigo-500 sm:w-5 sm:h-5" size={18} />
                              <h3 className="text-base sm:text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">Daily Challenges</h3>
                            </div>
                            <div className="text-[8px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">
                              Resets Daily
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                            {profile?.dailyChallenges?.challenges.map(challenge => (
                              <div key={challenge.id} className={cn(
                                "p-3 sm:p-4 rounded-xl sm:rounded-2xl border transition-all relative overflow-hidden",
                                challenge.completed 
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                                  : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800"
                              )}>
                                <div className="flex justify-between items-start mb-2">
                                  <div className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest opacity-60">
                                    {challenge.type.replace('_', ' ')}
                                  </div>
                                  {challenge.completed && <CheckCircle2 size={14} className="text-emerald-500" />}
                                </div>
                                <div className="font-bold text-xs sm:text-sm mb-2">{challenge.goal === 1 ? "Win a game" : `Play ${challenge.goal} games`}</div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className={cn("h-full transition-all duration-500", challenge.completed ? "bg-emerald-500" : "bg-indigo-500")}
                                    style={{ width: `${Math.min(100, (challenge.current / challenge.goal) * 100)}%` }}
                                  />
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                  <span className="text-[8px] sm:text-[10px] font-black">{challenge.current}/{challenge.goal}</span>
                                  <span className="text-[8px] sm:text-[10px] font-black text-indigo-500">+{challenge.reward} XP</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {profileTab === 'achievements' && (
                        <div className="space-y-4 sm:space-y-6">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <Award className="text-indigo-500 sm:w-5 sm:h-5" size={18} />
                            <h3 className="text-base sm:text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">Achievements</h3>
                          </div>
                          <div className="flex flex-wrap gap-3 sm:gap-4">
                            {profile?.achievements?.map(achievement => (
                              <div key={achievement.id} className="group relative">
                                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center text-2xl sm:text-3xl shadow-lg hover:scale-110 transition-all cursor-help">
                                  {achievement.icon}
                                </div>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 p-2 bg-slate-900 text-white text-[8px] sm:text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center shadow-xl">
                                  <div className="font-black uppercase tracking-widest mb-1">{achievement.name}</div>
                                  <div className="opacity-70">{achievement.description}</div>
                                </div>
                              </div>
                            ))}
                            {(!profile?.achievements || profile.achievements.length === 0) && (
                              <div className="text-slate-400 italic text-xs sm:text-sm py-4">No achievements unlocked yet. Keep playing!</div>
                            )}
                          </div>
                        </div>
                      )}

                      {profileTab === 'following' && (
                        <div className="space-y-4 sm:space-y-6">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <Users className="text-indigo-500 sm:w-5 sm:h-5" size={18} />
                            <h3 className="text-base sm:text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">Following</h3>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            {followingProfiles.length === 0 ? (
                              <div className="col-span-full text-slate-400 italic text-xs sm:text-sm py-4">You aren't following anyone yet. Visit the leaderboard to find friends!</div>
                            ) : (
                              followingProfiles.map(friend => (
                                <div key={friend.uid} className="bg-slate-50 dark:bg-slate-800/50 p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between group">
                                  <div className="flex items-center gap-3">
                                    <div className="relative">
                                      <img src={friend.photoURL} alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl border-2 border-white dark:border-slate-800 shadow-md" />
                                      <div className={cn(
                                        "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 shadow-sm",
                                        friendStatus[friend.uid] === 'online' ? "bg-emerald-500" : 
                                        friendStatus[friend.uid] === 'in-game' ? "bg-indigo-500" : "bg-slate-400"
                                      )} />
                                    </div>
                                    <div>
                                      <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">{friend.displayName}</div>
                                      <div className="text-[8px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest">
                                        {friendStatus[friend.uid] || 'offline'}
                                      </div>
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => handleUnfollow(friend.uid)}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-all"
                                    title="Unfollow"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {profileTab === 'history' && (
                        <div className="space-y-4 sm:space-y-6">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <History className="text-indigo-500 sm:w-5 sm:h-5" size={18} />
                            <h3 className="text-base sm:text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">Match History</h3>
                          </div>
                          
                          <div className="space-y-3 sm:space-y-4">
                            {uniqueMatches.length === 0 ? (
                              <div className="text-center py-8 sm:py-12 bg-slate-50 dark:bg-slate-800/50 rounded-xl sm:rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 italic text-xs sm:text-sm">
                                No matches played yet.
                              </div>
                            ) : (
                              uniqueMatches.map((match) => (
                                <div key={match.matchId} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl sm:rounded-3xl p-3 sm:p-6 hover:shadow-xl transition-all group">
                                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                                    <div className="flex items-center gap-2 sm:gap-4">
                                      <div className={cn(
                                        "w-8 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl flex items-center justify-center font-black text-sm sm:text-xl shadow-lg",
                                        match.winner === profile?.displayName ? "bg-emerald-500 text-white shadow-emerald-500/20" : "bg-red-500 text-white shadow-red-500/20"
                                      )}>
                                        {match.winner === profile?.displayName ? "W" : "L"}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="font-bold text-xs sm:text-base text-slate-900 dark:text-white truncate">
                                          {match.winner?.toLowerCase().trim() === profile?.displayName?.toLowerCase().trim() ? "Victory" : "Defeat"}
                                        </div>
                                        <div className="text-[7px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">
                                          {match.timestamp?.toDate ? match.timestamp.toDate().toLocaleDateString() : "Just now"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1 sm:gap-2 justify-end w-full sm:w-auto">
                                      {match.players.map(p => (
                                        <span key={p} className={cn(
                                          "px-1.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[7px] sm:text-[10px] font-bold uppercase tracking-widest border",
                                          p.toLowerCase().trim() === profile?.displayName?.toLowerCase().trim() ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-500" : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500"
                                        )}>
                                          {p} {p.toLowerCase().trim() === profile?.displayName?.toLowerCase().trim() && "(You)"}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                
                                {match.roundHistory && match.roundHistory.length > 0 && (
                                  <div className="mt-3 sm:mt-6 pt-3 sm:pt-6 border-t border-slate-100 dark:border-slate-800">
                                    <details className="group/details">
                                      <summary className="list-none cursor-pointer flex items-center gap-2 text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-500 transition-colors">
                                        <ChevronDown className="group-open/details:rotate-180 transition-transform sm:w-3.5 sm:h-3.5" size={12} />
                                        Round Details
                                      </summary>
                                      <div className="mt-2 sm:mt-4 overflow-x-auto">
                                        <table className="w-full text-left text-[8px] sm:text-xs min-w-[240px]">
                                          <thead>
                                            <tr className="text-slate-400 dark:text-slate-500">
                                              <th className="pb-1 sm:pb-2 font-black uppercase">Round</th>
                                              {match.players.map(p => (
                                                <th key={p} className="pb-1 sm:pb-2 font-black uppercase truncate max-w-[80px]">{p}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {match.roundHistory.map((round, rIdx) => (
                                              <tr key={round.roundNumber} className="border-t border-slate-50 dark:border-slate-800/50">
                                                <td className="py-1.5 sm:py-2 text-slate-400">#{round.roundNumber}</td>
                                                {match.players.map(p => {
                                                  const pLower = p.toLowerCase().trim();
                                                  
                                                  // Helper to get score for a player name with robust key matching
                                                  const getPlayerScore = (scores: Record<string, number>) => {
                                                    const key = Object.keys(scores).find(k => k.toLowerCase().trim() === pLower);
                                                    return key ? scores[key] : 0;
                                                  };
    
                                                  const isEliminatedNow = round.eliminatedPlayers?.some(ep => ep.toLowerCase().trim() === pLower) || false;
                                                  const wasEliminatedBefore = rIdx > 0 && (match.roundHistory![rIdx - 1].eliminatedPlayers?.some(ep => ep.toLowerCase().trim() === pLower) || false);
                                                  const isEliminatedInThisRound = isEliminatedNow && !wasEliminatedBefore;
                                                  const wasAlreadyEliminated = wasEliminatedBefore;
                                                  const currentRoundScore = getPlayerScore(round.scores);
                                                  
                                                  return (
                                                    <td key={p} className={cn("py-1.5 sm:py-2 font-mono", currentRoundScore === 0 && !wasAlreadyEliminated ? "text-emerald-500 font-bold" : "text-slate-600 dark:text-slate-400")}>
                                                      {wasAlreadyEliminated ? (
                                                        <span className="opacity-20">-</span>
                                                      ) : (
                                                        <div className="flex items-center gap-1">
                                                          <span>{currentRoundScore}</span>
                                                          {isEliminatedInThisRound && (
                                                            <span className="text-[6px] sm:text-[8px] text-red-500 font-black uppercase tracking-tighter leading-none bg-red-500/10 px-1 py-0.5 rounded">Eliminated</span>
                                                          )}
                                                        </div>
                                                      )}
                                                    </td>
                                                  );
                                                })}
                                              </tr>
                                            ))}
                                            <tr className="border-t border-slate-200 dark:border-slate-700 font-bold">
                                              <td className="py-1.5 sm:py-2 text-indigo-500">Total</td>
                                              {match.players.map(p => {
                                                const pLower = p.toLowerCase().trim();
                                                const key = Object.keys(match.scores).find(k => k.toLowerCase().trim() === pLower);
                                                const totalScore = key ? match.scores[key] : 0;
                                                return (
                                                  <td key={p} className="py-2 text-indigo-500 font-mono">
                                                    {totalScore}
                                                  </td>
                                                );
                                              })}
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </details>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }

    if (activeView === "leaderboard") {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 font-sans transition-colors duration-300">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setActiveView("home")}
                className="flex items-center gap-2 text-slate-500 hover:text-indigo-500 font-bold transition-colors"
              >
                <ArrowRight className="rotate-180" size={20} />
                Back to Lobby
              </button>
              <div className="flex items-center gap-4">
                <button onClick={toggleTheme} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors">
                  {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[1.5rem] sm:rounded-[2.5rem] p-4 sm:p-12 shadow-2xl border border-slate-200 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-8 sm:mb-12">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-indigo-500 rounded-2xl sm:rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-indigo-500/20">
                    <Trophy size={24} className="sm:w-8 sm:h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-4xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-none">Leaderboard</h2>
                    <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-[10px] sm:text-xs mt-1">Global Rankings</p>
                  </div>
                </div>
                
                {user && profile && (
                  <div className="bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-2xl sm:rounded-3xl px-4 py-3 sm:px-6 sm:py-4 flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-center">
                    <div className="text-right">
                      <div className="text-[8px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">Your Standing</div>
                      <div className="text-lg sm:text-xl font-black italic text-indigo-500">Rank #{rank || "?"}</div>
                    </div>
                    <img src={profile.photoURL} alt="" className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl border-2 border-indigo-500/20" />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {loadingLeaderboard ? (
                  <div className="text-center py-24">
                    <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Syncing Rankings...</p>
                  </div>
                ) : leaderboard.length === 0 ? (
                  <div className="text-center py-24 text-slate-400 italic">No legends yet. Start playing to claim your spot!</div>
                ) : (
                  <>
                    <div className="grid grid-cols-[40px_1fr_80px] sm:grid-cols-[60px_1fr_100px] px-4 sm:px-6 py-2 text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <span>Rank</span>
                      <span>Player</span>
                      <span className="text-right">Wins</span>
                    </div>
                    {leaderboard.map((entry, i) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        key={entry.uid} 
                        className={cn(
                          "grid grid-cols-[40px_1fr_80px] sm:grid-cols-[60px_1fr_100px] items-center p-3 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all",
                          entry.uid === user?.id 
                            ? "bg-indigo-500/10 border-indigo-500/30 ring-2 ring-indigo-500/10" 
                            : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-indigo-200 dark:hover:border-indigo-800 group"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center font-black italic text-base sm:text-lg",
                          i === 0 ? "bg-yellow-400 text-slate-900 shadow-lg shadow-yellow-400/20" : 
                          i === 1 ? "bg-slate-200 text-slate-900 shadow-lg shadow-slate-200/20" :
                          i === 2 ? "bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/20" : "text-slate-400 dark:text-slate-500"
                        )}>
                          {i + 1}
                        </div>
                        
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <div className="relative flex-shrink-0">
                            <img src={entry.photoURL} alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl border-2 border-white dark:border-slate-800 shadow-md" />
                            {i < 3 && (
                              <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-white dark:bg-slate-800 rounded-full p-0.5 sm:p-1 shadow-md">
                                <Trophy size={8} className={cn(
                                  "sm:w-2.5 sm:h-2.5",
                                  i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-400" : "text-amber-500"
                                )} />
                              </div>
                            )}
                          </div>
                          <div className="truncate">
                            <div className="font-black text-sm sm:text-lg text-slate-900 dark:text-white truncate flex items-center gap-1.5 sm:gap-2">
                              {entry.displayName}
                              {entry.uid === user?.id && <span className="text-[8px] sm:text-[10px] bg-indigo-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-tighter">You</span>}
                            </div>
                            <div className="text-[8px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest">{entry.gamesPlayed} Games Played</div>
                          </div>
                        </div>

                        <div className="text-right flex flex-col items-end gap-1">
                          <div className="text-xl sm:text-3xl font-black text-indigo-500 italic leading-none">{entry.wins}</div>
                          <div className="text-[6px] sm:text-[8px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest mt-0.5 sm:mt-1">Victories</div>
                          {user && entry.uid !== user.id && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                profile?.following?.includes(entry.uid) 
                                  ? handleUnfollow(entry.uid) 
                                  : handleFollow(entry.uid);
                              }}
                              className={cn(
                                "mt-2 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all border",
                                profile?.following?.includes(entry.uid)
                                  ? "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20"
                                  : "bg-indigo-500 text-white border-indigo-400 hover:bg-indigo-400"
                              )}
                            >
                              {profile?.following?.includes(entry.uid) ? "Unfollow" : "Follow"}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}

                    {user && profile && !leaderboard.find(e => e.uid === user.uid) && (
                      <>
                        <div className="flex justify-center py-4 gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                        </div>
                        <div className="grid grid-cols-[60px_1fr_100px] items-center p-4 sm:p-6 rounded-3xl border bg-indigo-500/10 border-indigo-500/30 ring-2 ring-indigo-500/10">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black italic text-lg text-slate-400 dark:text-slate-500">
                            {rank || "?"}
                          </div>
                          <div className="flex items-center gap-4 min-w-0">
                            <img src={profile.photoURL} alt="" className="w-12 h-12 rounded-2xl border-2 border-white dark:border-slate-800 shadow-md" />
                            <div className="truncate">
                              <div className="font-black text-lg text-slate-900 dark:text-white truncate flex items-center gap-2">
                                {profile.displayName} <span className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">You</span>
                              </div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest">{profile.gamesPlayed} Games Played</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl font-black text-indigo-500 italic leading-none">{profile.wins}</div>
                            <div className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest mt-1">Victories</div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8 flex flex-col items-center justify-center font-sans transition-colors duration-300">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center space-y-4">
            <div className="relative inline-block">
              <div className="w-24 h-24 bg-indigo-500 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl shadow-indigo-500/20 rotate-12">
                <Gamepad2 size={48} />
              </div>
              <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg -rotate-12 border-4 border-slate-50 dark:border-slate-950">
                <Trophy size={20} />
              </div>
            </div>
            <div>
              <h1 className="text-5xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white leading-none">Least Count</h1>
              <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-xs mt-2">The Ultimate Card Challenge</p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-8">
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
              <button 
                onClick={() => { openStats(); playSound("click"); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all text-slate-500 hover:text-indigo-500"
              >
                <UserIcon size={18} />
                Profile
              </button>
              <button 
                onClick={() => { openLeaderboard(); playSound("click"); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all text-slate-500 hover:text-indigo-500"
              >
                <Trophy size={18} />
                Leaderboard
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 ml-4">Your Name</label>
                <div className="relative group">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none transition-all font-bold text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={createRoom}
                  className="w-full bg-indigo-500 hover:bg-indigo-400 text-white py-5 rounded-2xl font-black uppercase italic transition-all shadow-xl shadow-indigo-500/10 flex items-center justify-center gap-3 group"
                >
                  <Plus className="group-hover:rotate-90 transition-transform" size={24} />
                  Create Room
                </button>
                
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-slate-100 dark:border-slate-800"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600">or join existing</span>
                  <div className="flex-grow border-t border-slate-100 dark:border-slate-800"></div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="ROOM ID"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    className="flex-1 px-6 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none transition-all font-black text-center tracking-widest text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600"
                  />
                  <button
                    onClick={joinRoom}
                    className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-8 py-4 rounded-2xl font-black uppercase italic hover:scale-105 transition-all shadow-xl"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>

            {!user && (
              <button 
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 py-4 border-2 border-slate-100 dark:border-slate-800 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                <LogIn size={20} />
                Sign in with Google
              </button>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">
                <Settings size={14} />
                Game Rules
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Players</div>
                  <input 
                    type="number" 
                    value={isNaN(config.maxPlayers) ? "" : config.maxPlayers}
                    onChange={(e) => setConfig({...config, maxPlayers: parseInt(e.target.value)})}
                    className="w-full bg-transparent text-lg font-black outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Call Limit</div>
                  <input 
                    type="number" 
                    value={isNaN(config.callLimit) ? "" : config.callLimit}
                    onChange={(e) => setConfig({...config, callLimit: parseInt(e.target.value)})}
                    className="w-full bg-transparent text-lg font-black outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Elimination</div>
                  <input 
                    type="number" 
                    value={isNaN(config.eliminationLimit) ? "" : config.eliminationLimit}
                    onChange={(e) => setConfig({...config, eliminationLimit: parseInt(e.target.value)})}
                    className="w-full bg-transparent text-lg font-black outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Penalty</div>
                  <input 
                    type="number" 
                    value={isNaN(config.penaltyValue) ? "" : config.penaltyValue}
                    onChange={(e) => setConfig({...config, penaltyValue: parseInt(e.target.value)})}
                    className="w-full bg-transparent text-lg font-black outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Turn Timer</div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      disabled={!config.isTimerEnabled}
                      value={isNaN(config.turnTimeLimit) ? "" : config.turnTimeLimit}
                      onChange={(e) => setConfig({...config, turnTimeLimit: parseInt(e.target.value)})}
                      className="w-full bg-transparent text-lg font-black outline-none text-slate-900 dark:text-white disabled:opacity-30"
                    />
                    <button 
                      onClick={() => setConfig({...config, isTimerEnabled: !config.isTimerEnabled})}
                      className={cn(
                        "p-1 rounded-md transition-colors",
                        config.isTimerEnabled ? "text-emerald-500 bg-emerald-500/10" : "text-slate-400 bg-slate-400/10"
                      )}
                    >
                      {config.isTimerEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 text-slate-400 dark:text-slate-600">
            <button onClick={toggleTheme} className="hover:text-indigo-500 transition-colors">
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-800"></div>
            <p className="text-[10px] font-black uppercase tracking-widest">v1.2.0 Stable</p>
          </div>
        </div>
      </div>
    );
  }

  if (room.gameState.status === "lobby") {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4 transition-colors duration-300">
        <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xl">
          <div className="p-6 sm:p-8 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="text-center sm:text-left">
                <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
                  <h2 className="text-xl sm:text-2xl font-black tracking-tighter uppercase italic text-indigo-500">Room: {room.id}</h2>
                  <button 
                    onClick={copyInviteLink}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl transition-all border text-[10px] font-black uppercase tracking-widest",
                      copied 
                        ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500" 
                        : "bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                    )}
                  >
                    {copied ? <CheckCircle2 size={12} /> : <Plus size={12} className="rotate-45" />}
                    {copied ? "Copied!" : "Invite Link"}
                  </button>
                </div>
                <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-widest mt-1">Waiting for players...</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
              <button 
                onClick={toggleTheme}
                className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
              >
                {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
              </button>
              <button 
                onClick={exitGame}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-3 rounded-xl font-bold text-sm transition-all border border-red-500/20"
              >
                Exit
              </button>
              {me?.isHost && (
                <button 
                  onClick={startGame}
                  disabled={room.players.length < 2}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-black uppercase italic transition-all shadow-xl shadow-emerald-500/10"
                >
                  <Play size={18} fill="currentColor" />
                  Start
                </button>
              )}
            </div>
          </div>
          <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {room.players.map((player) => (
              <div key={player.id} className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/50 p-5 rounded-3xl border border-slate-200 dark:border-slate-700">
                <div className="w-14 h-14 bg-indigo-500 rounded-2xl flex items-center justify-center font-black text-2xl text-white shadow-lg">
                  {player.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-black text-lg flex items-center gap-2 text-slate-900 dark:text-white">
                    {player.name}
                    {player.isHost && <span className="text-[8px] bg-indigo-500/10 text-indigo-500 px-2 py-0.5 rounded-full uppercase font-black tracking-widest">Host</span>}
                    {player.isBot && <span className="text-[8px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full uppercase font-black tracking-widest">Bot</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                    Ready to play
                    {me?.isHost && player.isBot && (
                      <button 
                        onClick={() => removeBot(player.id)}
                        className="text-red-500 hover:text-red-400 font-black text-[8px] uppercase tracking-widest ml-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {Array.from({ length: room.config.maxPlayers - room.players.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 bg-slate-50/50 dark:bg-slate-800/20 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 border-dashed">
                <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-300 dark:text-slate-600">
                  <Plus size={24} />
                </div>
                <div className="text-slate-300 dark:text-slate-600 font-black italic uppercase tracking-widest text-sm">Waiting...</div>
              </div>
            ))}
          </div>

          {me?.isHost && (
            <div className="p-6 sm:p-8 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">
                  <Settings size={14} />
                  Room Settings
                </div>
                {room.players.length < room.config.maxPlayers && (
                  <button 
                    onClick={addBot}
                    className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-500 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border border-amber-500/20"
                  >
                    <Plus size={12} />
                    Add Bot
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Players</div>
                  <select 
                    value={room.config.maxPlayers}
                    onChange={(e) => updateConfig({ ...room.config, maxPlayers: parseInt(e.target.value) })}
                    className="w-full bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none cursor-pointer"
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Call Limit</div>
                  <input 
                    type="number"
                    value={room.config.callLimit}
                    onChange={(e) => updateConfig({ ...room.config, callLimit: parseInt(e.target.value) })}
                    className="w-full bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none"
                  />
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Elimination</div>
                  <input 
                    type="number"
                    value={room.config.eliminationLimit}
                    onChange={(e) => updateConfig({ ...room.config, eliminationLimit: parseInt(e.target.value) })}
                    className="w-full bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none"
                  />
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Penalty</div>
                  <input 
                    type="number"
                    value={room.config.penaltyValue}
                    onChange={(e) => updateConfig({ ...room.config, penaltyValue: parseInt(e.target.value) })}
                    className="w-full bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none"
                  />
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Bot Difficulty</div>
                  <select 
                    value={room.config.botDifficulty}
                    onChange={(e) => updateConfig({ ...room.config, botDifficulty: e.target.value as any })}
                    className="w-full bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none cursor-pointer"
                  >
                    <option value="easy">Easy</option>
                    <option value="normal">Normal</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black">Spectators</div>
                  <input 
                    type="checkbox"
                    checked={room.config.allowSpectators}
                    onChange={(e) => updateConfig({ ...room.config, allowSpectators: e.target.checked })}
                    className="w-5 h-5 accent-indigo-500 rounded cursor-pointer"
                  />
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black mb-1">Timer</div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox"
                      checked={room.config.isTimerEnabled}
                      onChange={(e) => updateConfig({ ...room.config, isTimerEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {room.config.isTimerEnabled && (
                      <input 
                        type="number"
                        value={room.config.turnTimeLimit}
                        onChange={(e) => updateConfig({ ...room.config, turnTimeLimit: parseInt(e.target.value) })}
                        className="w-12 bg-transparent text-lg font-black text-slate-900 dark:text-white outline-none"
                      />
                    )}
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      {room.config.isTimerEnabled ? "s" : "Off"}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-4 italic">* Settings can be adjusted by the host before starting.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-2 sm:p-4 flex flex-col items-center font-sans overflow-hidden transition-colors duration-300">
      {showDisconnectOverlay && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-sm w-full text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Connection Lost</h3>
              <p className="text-slate-500 dark:text-slate-400">Attempting to reconnect to the game server...</p>
            </div>
            <div className="pt-4">
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-xl font-bold transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex justify-between items-center mb-4 sm:mb-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur p-2 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 sm:gap-4">
          <button 
            onClick={exitGame}
            className="p-1.5 sm:p-2 hover:bg-red-500/10 text-red-500 rounded-xl transition-colors border border-transparent hover:border-red-500/20"
            title="Exit Game"
          >
            <X size={18} className="sm:w-5 sm:h-5" />
          </button>
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Leaderboard and Profile options removed during game as per user request */}
          </div>
        </div>
        <div className="text-center hidden md:block">
          <h1 className="text-xl font-black tracking-tighter text-indigo-500 dark:text-indigo-400 uppercase italic">Least Count</h1>
          <div className="flex items-center justify-center gap-3 mt-1">
            <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">Room: {room.id}</div>
            <div className="w-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
            <div className="flex items-center gap-2 text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">
              <span>Call: {room.config.callLimit}</span>
              <span className="opacity-30">|</span>
              <span>Limit: {room.config.eliminationLimit}</span>
              <span className="opacity-30">|</span>
              <span>Penalty: {room.config.penaltyValue}</span>
              <span className="opacity-30">|</span>
              <span>Time: {room.config.turnTimeLimit}s</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {isSpectator && (
            <div className="bg-amber-500/10 text-amber-500 px-3 py-1.5 rounded-xl border border-amber-500/20 shadow-inner flex items-center gap-2">
              <Eye size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Spectating</span>
            </div>
          )}
          {room.spectators.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner">
              <Users size={14} className="text-slate-400 dark:text-slate-500" />
              <span className="text-[10px] font-black text-slate-500 dark:text-slate-400">{room.spectators.length}</span>
            </div>
          )}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner">
            <div className="text-right">
              <div className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold">Turn</div>
              <div className={cn(
                "text-[10px] font-black transition-all truncate max-w-[60px]",
                isMyTurn ? "text-emerald-500" : "text-indigo-500 dark:text-indigo-400"
              )}>
                {isMyTurn ? "YOU" : (
                  <span className="flex items-center gap-1">
                    {room.players[room.gameState.turnIndex]?.name || "..."}
                    {room.players[room.gameState.turnIndex]?.isBot && (
                      <span className="text-[6px] bg-amber-500/10 text-amber-500 px-1 py-0.5 rounded-full uppercase font-black tracking-widest">Bot</span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
            <button 
              onClick={toggleTheme}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400"
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
            <button 
              onClick={() => setShowEmojis(!showEmojis)}
              className={cn(
                "p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors",
                showEmojis ? "text-indigo-500" : "text-slate-500 dark:text-slate-400"
              )}
              title={showEmojis ? "Hide Emojis" : "Show Emojis"}
            >
              {showEmojis ? <Smile size={16} /> : <Smile size={16} className="opacity-50" />}
            </button>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
            <button 
              onClick={() => { setIsMuted(!isMuted); playSound("click"); }}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400"
              title={isMuted ? "Unmute Sounds" : "Mute Sounds"}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Turn Banner */}
      <AnimatePresence>
        {room.gameState.status === "playing" && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "mb-2 sm:mb-4 py-2 px-4 sm:px-6 rounded-xl text-center font-bold text-[10px] sm:text-sm shadow-xl border flex items-center justify-between gap-2 sm:gap-3 w-full max-w-6xl mx-auto",
              isMyTurn 
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/10" 
                : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
            )}
          >
            <div className="flex items-center gap-2 sm:gap-3">
              {isMyTurn ? (
                <>
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="truncate">
                    YOUR TURN: {myTurnPhase === "discarding" 
                      ? "Discard cards. Match rank to skip draw!" 
                      : "Draw from deck or pile"}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-indigo-400 rounded-full animate-pulse" />
                  <span className="truncate">
                    Waiting for {room.players[room.gameState.turnIndex]?.name || "next player"}
                    {room.players[room.gameState.turnIndex]?.isBot && (
                      <span className="ml-2 text-[8px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full uppercase font-black tracking-widest">Bot</span>
                    )}
                    ...
                  </span>
                </>
              )}
            </div>

            {timeLeft !== null && (
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[8px] uppercase tracking-widest opacity-60">Time Left</span>
                  <span className={cn("text-xs font-black", timeLeft <= 10 ? "text-red-500" : "")}>{timeLeft}s</span>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-current flex items-center justify-center relative">
                  <svg className="w-full h-full -rotate-90 absolute inset-0">
                    <circle
                      cx="50%"
                      cy="50%"
                      r="40%"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray="100"
                      strokeDashoffset={100 - (100 * timeLeft) / (room.config.turnTimeLimit || 30)}
                      className="transition-all duration-1000 linear"
                    />
                  </svg>
                  <span className={cn("text-[10px] sm:text-xs font-black", timeLeft <= 10 ? "text-red-500 animate-pulse" : "")}>{timeLeft}</span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Table */}
      <div 
        ref={tableRef}
        className={cn(
          "flex-1 relative flex items-center justify-center rounded-[2rem] sm:rounded-[4rem] border-4 sm:border-8 shadow-2xl m-2 sm:m-4 transition-all duration-500 min-h-[400px] sm:min-h-0 max-w-6xl mx-auto w-full select-none",
          isMyTurn ? "bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20 dark:border-emerald-500/40 ring-4 sm:ring-8 ring-emerald-500/5" : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800"
        )}
      >
        {/* Opponents */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          {opponents.map((opp, idx) => {
            const totalOpponents = opponents.length;
            const angleStep = 180 / (totalOpponents + 1);
            const angle = (idx + 1) * angleStep - 90; // -90 to 90 range
            
            // Dynamic radius based on table size
            const radiusX = tableSize.width * 0.35;
            const radiusY = tableSize.height * 0.35;
            
            const x = Math.sin(angle * (Math.PI / 180)) * radiusX;
            const y = -Math.cos(angle * (Math.PI / 180)) * radiusY;

            return (
              <div 
                key={opp.id}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 sm:gap-2 pointer-events-auto z-30"
                style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
              >
                <div className={cn(
                  "w-10 h-10 sm:w-16 sm:h-16 rounded-full border-2 sm:border-4 flex items-center justify-center text-sm sm:text-xl font-bold transition-all shadow-lg relative",
                  room.gameState.turnIndex === room.players.indexOf(opp) ? "border-indigo-500 bg-indigo-500 text-white scale-110 shadow-indigo-500/20" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500",
                  opp.isEliminated && "opacity-30 grayscale"
                )}>
                  {opp.name[0].toUpperCase()}
                  {showEmojis && activeEmojis[opp.id] && (
                    <motion.div 
                      initial={{ scale: 0, y: 0, opacity: 0 }}
                      animate={{ scale: 1.5, y: -40, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="absolute text-2xl z-50 pointer-events-none"
                    >
                      {activeEmojis[opp.id].emoji}
                    </motion.div>
                  )}
                </div>
                <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur px-2 py-0.5 sm:px-3 sm:py-1 rounded-full border border-slate-200 dark:border-slate-700 text-[8px] sm:text-xs font-bold flex items-center gap-1 sm:gap-2 shadow-lg">
                  <span className="truncate max-w-[40px] sm:max-w-none dark:text-slate-200">{opp.name}</span>
                  {opp.isBot && <span className="text-[6px] bg-amber-500/10 text-amber-500 px-1 py-0.5 rounded-full uppercase font-black tracking-widest">Bot</span>}
                  {opp.isAway && <span className="text-[6px] bg-orange-500/10 text-orange-500 px-1 py-0.5 rounded-full uppercase font-black tracking-widest animate-pulse">Away</span>}
                  <span className="text-indigo-500 dark:text-indigo-400">{opp.score}</span>
                </div>
                <div className="flex -space-x-2 sm:-space-x-4">
                  {Array.from({ length: Math.min(opp.hand.length, 5) }).map((_, i) => (
                    <div key={i} className="w-4 h-6 sm:w-8 sm:h-12 bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-sm sm:rounded-md shadow-sm" />
                  ))}
                  {opp.hand.length > 5 && (
                    <div className="text-[8px] font-bold text-slate-400 dark:text-slate-500 self-center ml-1">+{opp.hand.length - 5}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Area */}
        <div className="flex flex-row items-center gap-3 sm:gap-12 z-10 scale-[0.75] sm:scale-100">
          <div className="flex items-center gap-3 sm:gap-12">
            {/* Deck */}
            <div 
              onClick={isMyTurn && myTurnPhase === "drawing" ? drawFromDeck : undefined}
              className={cn(
                "w-16 h-24 sm:w-24 sm:h-36 bg-white dark:bg-slate-800 rounded-xl border-4 flex flex-col items-center justify-center shadow-2xl transition-all relative",
                isMyTurn && myTurnPhase === "drawing" ? "cursor-pointer hover:scale-105 hover:ring-8 ring-emerald-500/30 border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10" : "border-slate-200 dark:border-slate-700 opacity-80"
              )}
            >
              <div className="text-indigo-500 dark:text-indigo-400 font-black text-xl sm:text-3xl italic opacity-50">LC</div>
              <div className="text-[7px] sm:text-[10px] text-indigo-400 dark:text-indigo-500 mt-1 sm:mt-2 font-bold uppercase">Draw</div>
              {isMyTurn && myTurnPhase === "drawing" && (
                <motion.div 
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity }}
                  className="absolute -top-2 -right-2 bg-emerald-500 text-white p-0.5 rounded-full shadow-lg"
                >
                  <ArrowRight size={14} />
                </motion.div>
              )}
            </div>

            {/* Joker Card */}
            {room.gameState.joker && (
              <div className="flex flex-col items-center gap-1 sm:gap-2">
                <CardComponent card={room.gameState.joker} disabled className="scale-75 sm:scale-100" isWildJoker />
                <div className="text-[7px] sm:text-[10px] text-indigo-500 dark:text-indigo-400 font-black uppercase tracking-widest bg-indigo-50 dark:bg-indigo-950/30 px-1.5 py-0.5 sm:py-1 rounded-full border border-indigo-100 dark:border-indigo-900">
                  Joker
                </div>
              </div>
            )}
          </div>

          {/* Discard Pile */}
          <div className="relative group">
            <div className="absolute -inset-4 bg-indigo-500/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            <div 
              onClick={isMyTurn && myTurnPhase === "drawing" ? drawFromDiscard : undefined}
              className={cn(
                "relative transition-all",
                isMyTurn && myTurnPhase === "drawing" && "cursor-pointer hover:scale-105 ring-8 ring-emerald-500/30 rounded-lg"
              )}
            >
              {room.gameState.discardPile.length > 0 && (
                <CardComponent 
                  card={room.gameState.discardPile[room.gameState.discardPile.length - 1]} 
                  disabled={!(isMyTurn && myTurnPhase === "drawing")} 
                  className="scale-75 sm:scale-100" 
                />
              )}
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[7px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest whitespace-nowrap">
                Discard Pile
              </div>
            </div>
          </div>

          {/* Player Discard Slot (Current Turn) */}
          {room.gameState.currentTurnDiscard && room.gameState.currentTurnDiscard.length > 0 && (
            <div className="relative group ml-4 sm:ml-8">
              <div className="absolute -inset-4 bg-amber-500/10 blur-2xl rounded-full opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex -space-x-4 sm:-space-x-6">
                  {room.gameState.currentTurnDiscard.map((card, idx) => (
                    <CardComponent 
                      key={`${card.suit}-${card.rank}-${idx}`}
                      card={card} 
                      disabled={true} 
                      className="scale-75 sm:scale-100 shadow-xl" 
                    />
                  ))}
                </div>
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[7px] sm:text-[10px] text-amber-500 dark:text-amber-400 font-bold uppercase tracking-widest whitespace-nowrap">
                  Player Discard
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Logs */}
      <div className="h-12 flex items-center justify-center mb-4 w-full max-w-6xl mx-auto">
        <AnimatePresence mode="wait">
          {room.gameState.lastAction && (
            <motion.div 
              key={room.gameState.lastAction}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-4 py-1 rounded-full border border-indigo-500/20 text-xs font-medium italic shadow-lg"
            >
              {room.gameState.lastAction}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Player Hand */}
      <div className="relative pt-10 sm:pt-12 pb-4 sm:pb-8 w-full max-w-6xl mx-auto select-none">
        {/* Emoji Toggle Button */}
        <button 
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className={cn(
            "absolute -top-12 left-4 p-2 rounded-xl border transition-all z-[60]",
            showEmojiPicker ? "bg-indigo-500 text-white border-indigo-400" : "bg-white/90 dark:bg-slate-800/90 text-slate-500 border-slate-200 dark:border-slate-700"
          )}
        >
          <Smile size={20} />
        </button>

        {/* Emoji Quick Actions */}
        <AnimatePresence>
          {showEmojiPicker && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="absolute -top-12 left-16 flex items-center gap-1 sm:gap-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl z-50 overflow-x-auto max-w-[70vw] scrollbar-hide"
            >
              {["👍", "👎", "😂", "😮", "😢", "🔥", "🃏", "👑"].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => { sendEmoji(emoji); setShowEmojiPicker(false); }}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all hover:scale-125 text-lg"
                >
                  {emoji}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-4 w-full justify-center px-4">
          <div className="relative">
            <div className={cn(
              "w-8 h-8 sm:w-10 sm:h-10 rounded-xl border-2 flex items-center justify-center text-xs sm:text-sm font-black shadow-lg",
              isMyTurn ? "border-emerald-500 bg-emerald-500 text-white animate-pulse" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500"
            )}>
              {me?.name[0].toUpperCase()}
              {showEmojis && activeEmojis[me?.id || ""] && (
                <motion.div 
                  initial={{ scale: 0, y: 0, opacity: 0 }}
                  animate={{ scale: 1.5, y: -40, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute text-2xl z-50 pointer-events-none"
                >
                  {activeEmojis[me?.id || ""].emoji}
                </motion.div>
              )}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-1 sm:px-4 sm:py-1 rounded-full border border-slate-200 dark:border-slate-800 text-[10px] sm:text-xs font-bold shadow-xl whitespace-nowrap text-slate-900 dark:text-white">
            Score: <span className="text-indigo-500">{me?.score}</span>
          </div>
          <div className="bg-white dark:bg-slate-900 px-3 py-1 sm:px-4 sm:py-1 rounded-full border border-slate-200 dark:border-slate-800 text-[10px] sm:text-xs font-bold shadow-xl whitespace-nowrap text-slate-900 dark:text-white">
            Hand: <span className="text-yellow-500">{me ? getHandScore(me.hand, room.gameState.joker) : 0}</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 sm:gap-6">
        <div className="flex justify-center gap-2 sm:gap-5 flex-wrap px-4 sm:px-6 py-4 max-h-[240px] overflow-y-auto sm:max-h-none scrollbar-hide w-full max-w-6xl mx-auto">
            {me?.hand.map((card, i) => {
              const topDiscard = room.gameState.discardPile[room.gameState.discardPile.length - 1];
              const isMatch = topDiscard && card.rank === topDiscard.rank;
              const isWildJoker = room.gameState.joker && card.rank === room.gameState.joker.rank;
              
              return (
                <CardComponent 
                  key={`${card.suit}-${card.rank}-${i}`} 
                  card={card} 
                  selected={selectedCards.some(c => c.suit === card.suit && c.rank === card.rank)}
                  onClick={() => handleCardClick(card)}
                  disabled={!isMyTurn || (myTurnPhase !== "discarding" && myTurnPhase !== "drawing")}
                  isMatch={isMatch}
                  isWildJoker={isWildJoker}
                />
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 w-full px-4">
            {isMyTurn && myTurnPhase === "drawing" && (
              <div className="flex gap-2 w-full sm:w-auto mb-2 sm:mb-0">
                <button 
                  onClick={drawFromDeck}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold bg-indigo-500 text-white hover:bg-indigo-400 shadow-xl transition-all text-sm sm:text-base"
                >
                  <Plus size={18} />
                  Draw Deck
                </button>
                <button 
                  onClick={drawFromDiscard}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold bg-amber-500 text-white hover:bg-amber-400 shadow-xl transition-all text-sm sm:text-base"
                >
                  <ArrowRight size={18} className="rotate-90" />
                  Draw Discard
                </button>
              </div>
            )}

            <button 
              onClick={discardCards}
              disabled={!isMyTurn || selectedCards.length === 0 || myTurnPhase !== "discarding"}
              className={cn(
                "flex items-center justify-center gap-2 w-full sm:w-auto px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold transition-all border shadow-xl text-sm sm:text-base",
                isMyTurn && myTurnPhase === "discarding" && selectedCards.length > 0
                  ? "bg-emerald-500 text-white border-emerald-400 hover:bg-emerald-400 shadow-emerald-500/10"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed"
              )}
            >
              <ArrowRight size={18} />
              Discard
            </button>
            <button 
              onClick={declareLeastCount}
              disabled={!isMyTurn || (me ? getHandScore(me.hand, room.gameState.joker) : 0) > room.config.callLimit || myTurnPhase !== "discarding"}
              className={cn(
                "flex items-center justify-center gap-2 w-full sm:w-auto px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold transition-all shadow-xl text-white text-sm sm:text-base",
                isMyTurn && myTurnPhase === "discarding" && (me ? getHandScore(me.hand, room.gameState.joker) : 0) <= room.config.callLimit
                  ? "bg-indigo-500 hover:bg-indigo-400 shadow-indigo-500/10"
                  : "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 opacity-30 cursor-not-allowed"
              )}
            >
              <CheckCircle2 size={18} />
              Declare Least Count
            </button>
          </div>
        </div>
      </div>

      {/* Away Overlay */}
      <AnimatePresence>
        {me?.isAway && room?.gameState.status === "playing" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 sm:p-12 max-w-md w-full shadow-2xl text-center border border-slate-200 dark:border-slate-800 space-y-6"
            >
              <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto">
                <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin-slow" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">You are Away</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base font-medium">
                  The system is playing for you because you timed out. Click the button below to resume playing.
                </p>
              </div>
              <button
                onClick={backToGame}
                className="w-full py-4 sm:py-5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-lg sm:text-xl uppercase italic transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3"
              >
                <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                I am Back
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round End Overlay */}
      <AnimatePresence>
        {(room.gameState.status === "round_end" || room.gameState.status === "game_over") && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl flex items-start justify-center z-50 p-4 overflow-y-auto scrollbar-hide"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-200 dark:border-slate-800 p-6 sm:p-12 space-y-8 sm:space-y-10 shadow-2xl my-auto"
            >
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-indigo-500/10 rounded-3xl mb-4">
                  <Trophy className="w-10 h-10 text-indigo-500" />
                </div>
                <h2 className="text-2xl sm:text-4xl font-black tracking-tighter uppercase italic text-slate-900 dark:text-white">
                  {room.gameState.status === "game_over" ? "Game Over!" : "Scoreboard"}
                </h2>
                {room.gameState.status === "game_over" && (
                  <div className="flex items-center justify-center gap-3 text-xl sm:text-2xl font-bold text-emerald-500">
                    <CheckCircle2 size={24} className="sm:w-7 sm:h-7" />
                    Winner: {room.gameState.winner}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Score History</h3>
                  <div className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-full uppercase">
                    Limit: {room.config.eliminationLimit} pts
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <RoundHistoryTable room={room} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {room.players.map((p) => (
                  <div key={p.id} className={cn(
                    "p-5 rounded-[2rem] border transition-all",
                    p.isEliminated 
                      ? "bg-red-500/5 border-red-500/10 opacity-60" 
                      : "bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-indigo-500/50"
                  )}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-lg",
                          p.isEliminated ? "bg-red-500/20 text-red-400" : "bg-slate-50 dark:bg-slate-800 text-indigo-500 border border-slate-200 dark:border-slate-700"
                        )}>
                          {p.name[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                            {p.name}
                            {p.isBot && <span className="bg-indigo-500/10 text-indigo-500 text-[8px] px-1.5 py-0.5 rounded-full border border-indigo-500/20 font-black uppercase tracking-widest">Bot</span>}
                            {p.isAway && <span className="bg-orange-500/10 text-orange-500 text-[8px] px-1.5 py-0.5 rounded-full border border-orange-500/20 font-black uppercase tracking-widest animate-pulse">Away</span>}
                            {p.isEliminated && <XCircle size={16} className="text-red-500" />}
                          </div>
                          <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
                            Total: <span className="text-indigo-500">{p.score}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-tighter">Last Hand</div>
                        <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                          {getHandScore(p.hand, room.gameState.joker)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 space-y-4">
                {room.gameState.nextRoundCountdown !== undefined && room.gameState.status === "round_end" && (
                  <div className="text-center">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Next round in</div>
                    <div className="flex items-center justify-center gap-2">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div 
                          key={i} 
                          className={cn(
                            "w-2 h-2 rounded-full transition-all duration-300",
                            i < room.gameState.nextRoundCountdown! 
                              ? "bg-indigo-500 scale-110" 
                              : "bg-slate-200 dark:bg-slate-800 scale-90"
                          )}
                        />
                      ))}
                    </div>
                    <div className="text-3xl font-black text-indigo-500 mt-2 tabular-nums">
                      {room.gameState.nextRoundCountdown}s
                    </div>
                  </div>
                )}

                {me?.isHost && room.gameState.status !== "game_over" ? (
                  <button 
                    onClick={startGame}
                    className="w-full bg-indigo-500 hover:bg-indigo-400 text-white py-5 rounded-[1.5rem] font-black text-xl transition-all shadow-xl shadow-indigo-500/10 flex items-center justify-center gap-3"
                  >
                    <Play size={24} fill="currentColor" />
                    START NEXT ROUND
                  </button>
                ) : room.gameState.status === "game_over" ? (
                  <button 
                    onClick={exitGame}
                    className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white py-5 rounded-[1.5rem] font-black text-xl transition-all shadow-xl shadow-slate-200 dark:shadow-slate-950"
                  >
                    BACK TO LOBBY
                  </button>
                ) : (
                  <div className="w-full py-5 bg-slate-50 dark:bg-slate-800/50 rounded-[1.5rem] text-slate-400 dark:text-slate-500 font-bold italic text-center border border-dashed border-slate-200 dark:border-slate-800">
                    Waiting for host to start next round...
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
