import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { customAlphabet } from "nanoid";
const generateRoomId = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 4);

const PORT = 3000;

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
  botThinkTime: number;
  allowSpectators: boolean;
  jokerValue: number;
  doublePenaltyOnCatch: boolean;
  scoreReductionRule: "none" | "half_on_50" | "half_on_100";
}

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
  isSpectator: boolean;
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
  chat: ChatMessage[];
}

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const rooms: Map<string, Room> = new Map();
const roomTimers: Map<string, NodeJS.Timeout> = new Map();
const turnTimers: Map<string, NodeJS.Timeout> = new Map();

function sanitizeForFirestore(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.filter(item => item !== undefined).map(sanitizeForFirestore);
  } else if (obj !== null && typeof obj === "object") {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        sanitized[key] = sanitizeForFirestore(obj[key]);
      }
    }
    return sanitized;
  }
  return obj;
}

async function persistRoom(room: Room) {
  try {
    const sanitizedRoom = sanitizeForFirestore(room);
    console.log(`[Server] Persisting room ${room.id} to Supabase...`);
    const { error } = await supabase.from('active_rooms').upsert({
      id: room.id,
      data: sanitizedRoom
    });
    if (error) throw error;
    console.log(`[Server] Successfully persisted room ${room.id} to Supabase`);
  } catch (err) {
    console.error(`[Server] Error persisting room ${room.id}:`, err);
  }
}

async function getRoom(roomId: string, io: Server): Promise<Room | undefined> {
  const roomIdUpper = roomId.toUpperCase();
  if (rooms.has(roomIdUpper)) return rooms.get(roomIdUpper);

  try {
    const { data, error } = await supabase.from('active_rooms').select('data').eq('id', roomIdUpper).single();
    if (data && !error) {
      const room = data.data as Room;
      rooms.set(roomIdUpper, room);
      console.log(`[Server] Restored room ${roomIdUpper} from Supabase`);
      
      // Resume timers if necessary
      if (room.gameState.status === "playing") {
        startTurnTimer(io, room);
      } else if (room.gameState.status === "round_end" && room.gameState.nextRoundCountdown) {
        resumeRoundEndTimer(io, room);
      }
      
      return room;
    }
  } catch (err) {
    console.error(`[Server] Error restoring room ${roomIdUpper}:`, err);
  }
  return undefined;
}

function resumeRoundEndTimer(io: Server, room: Room) {
  const roomId = room.id;
  if (roomTimers.has(roomId)) clearInterval(roomTimers.get(roomId)!);

  const timer = setInterval(async () => {
    const currentRoom = await getRoom(roomId, io);
    if (!currentRoom || currentRoom.gameState.status !== "round_end") {
      clearInterval(timer);
      roomTimers.delete(roomId);
      return;
    }
    
    if (currentRoom.gameState.nextRoundCountdown! > 0) {
      currentRoom.gameState.nextRoundCountdown! -= 1;
      io.to(roomId).emit("ROOM_UPDATED", currentRoom);
      await persistRoom(currentRoom);
    } else {
      clearInterval(timer);
      roomTimers.delete(roomId);
      startNextRound(currentRoom);
      startTurnTimer(io, currentRoom);
      io.to(roomId).emit("GAME_STARTED", currentRoom);
      await persistRoom(currentRoom);
    }
  }, 1000);
  roomTimers.set(roomId, timer);
}

function startTurnTimer(io: Server, room: Room) {
  const roomId = room.id;
  if (turnTimers.has(roomId)) {
    clearTimeout(turnTimers.get(roomId)!);
    turnTimers.delete(roomId);
  }

  if (!room.config.isTimerEnabled) {
    delete room.gameState.turnEndTime;
    
    // Check if it's a bot's turn even if timer is disabled
    const currentPlayer = room.players[room.gameState.turnIndex];
    if (currentPlayer.isBot && !currentPlayer.isEliminated) {
      handleBotTurn(io, room);
    }
    return;
  }

  const timeLimit = (room.config.turnTimeLimit || 30) * 1000;
  room.gameState.turnEndTime = Date.now() + timeLimit;

  io.to(roomId).emit("ROOM_UPDATED", room);

    const timer = setTimeout(async () => {
    const currentRoom = await getRoom(roomId, io);
    if (!currentRoom || currentRoom.gameState.status !== "playing") return;

    const playerIndex = currentRoom.gameState.turnIndex;
    const player = currentRoom.players[playerIndex];
    
    console.log(`[Server] Timer expired for ${player.name} in room ${roomId}`);
    player.isAway = true; // Mark as away on timeout

    if (currentRoom.gameState.turnPhase === "discarding") {
      // Auto-discard highest card
      const sortedHand = [...player.hand].sort((a, b) => b.value - a.value);
      const cardToDiscard = sortedHand[0];
      
      const idx = player.hand.findIndex(c => c.suit === cardToDiscard.suit && c.rank === cardToDiscard.rank);
      if (idx !== -1) player.hand.splice(idx, 1);
      
      currentRoom.gameState.currentTurnDiscard = [cardToDiscard];
      currentRoom.gameState.turnPhase = "drawing";
      currentRoom.gameState.lastAction = `${player.name} timed out and auto-discarded`;
      
      // Now auto-draw as well
      const drawnCard = currentRoom.gameState.deck.pop();
      if (drawnCard) {
        player.hand.push(drawnCard);
        if (currentRoom.gameState.deck.length === 0) {
          // Move current discard to pile before reshuffle
          currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
          currentRoom.gameState.currentTurnDiscard = [];
          const topCard = currentRoom.gameState.discardPile.pop()!;
          currentRoom.gameState.deck = shuffleDeck(currentRoom.gameState.discardPile);
          currentRoom.gameState.discardPile = [topCard];
        }
      }
      
      // Move current discard to pile
      if (currentRoom.gameState.currentTurnDiscard.length > 0) {
        currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
        currentRoom.gameState.currentTurnDiscard = [];
      }

      // Move to next turn
      let nextTurn = (currentRoom.gameState.turnIndex + 1) % currentRoom.players.length;
      while (currentRoom.players[nextTurn].isEliminated) {
        nextTurn = (nextTurn + 1) % currentRoom.players.length;
      }
      currentRoom.gameState.turnIndex = nextTurn;
      currentRoom.gameState.turnPhase = "discarding";
      currentRoom.gameState.lastAction = `${player.name} timed out and auto-played`;
    } else {
      // Already discarded, just auto-draw
      const drawnCard = currentRoom.gameState.deck.pop();
      if (drawnCard) {
        player.hand.push(drawnCard);
        if (currentRoom.gameState.deck.length === 0) {
          // Move current discard to pile before reshuffle
          currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
          currentRoom.gameState.currentTurnDiscard = [];
          const topCard = currentRoom.gameState.discardPile.pop()!;
          currentRoom.gameState.deck = shuffleDeck(currentRoom.gameState.discardPile);
          currentRoom.gameState.discardPile = [topCard];
        }
      }
      
      // Move current discard to pile
      if (currentRoom.gameState.currentTurnDiscard.length > 0) {
        currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
        currentRoom.gameState.currentTurnDiscard = [];
      }

      // Move to next turn
      let nextTurn = (currentRoom.gameState.turnIndex + 1) % currentRoom.players.length;
      while (currentRoom.players[nextTurn].isEliminated) {
        nextTurn = (nextTurn + 1) % currentRoom.players.length;
      }
      currentRoom.gameState.turnIndex = nextTurn;
      currentRoom.gameState.turnPhase = "discarding";
      currentRoom.gameState.lastAction = `${player.name} timed out and auto-drew`;
    }

    io.to(roomId).emit("ROOM_UPDATED", currentRoom);
    await persistRoom(currentRoom);
    startTurnTimer(io, currentRoom);
  }, timeLimit);

  turnTimers.set(roomId, timer);
  
  // Check if it's a bot's turn or an away player's turn
  const currentPlayer = room.players[room.gameState.turnIndex];
  if (!currentPlayer.isEliminated) {
    if (currentPlayer.isBot) {
      handleBotTurn(io, room);
    } else if (currentPlayer.isAway) {
      // Auto-play for away players after a short delay (e.g., 2 seconds)
      setTimeout(async () => {
        const currentRoom = await getRoom(roomId, io);
        if (!currentRoom || currentRoom.gameState.status !== "playing") return;
        const p = currentRoom.players[currentRoom.gameState.turnIndex];
        if (p.id === currentPlayer.id && p.isAway) {
          await autoPlayTurn(io, currentRoom, p);
        }
      }, 2000);
    }
  }
}

async function autoPlayTurn(io: Server, room: Room, player: Player) {
  const roomId = room.id;
  if (turnTimers.has(roomId)) {
    clearTimeout(turnTimers.get(roomId)!);
    turnTimers.delete(roomId);
  }

  if (room.gameState.turnPhase === "discarding") {
    // Auto-discard highest card
    const sortedHand = [...player.hand].sort((a, b) => b.value - a.value);
    const cardToDiscard = sortedHand[0];
    
    const idx = player.hand.findIndex(c => c.suit === cardToDiscard.suit && c.rank === cardToDiscard.rank);
    if (idx !== -1) player.hand.splice(idx, 1);
    
    room.gameState.currentTurnDiscard = [cardToDiscard];
    room.gameState.turnPhase = "drawing";
    room.gameState.lastAction = `${player.name} is away and auto-discarded`;

    // Now auto-draw as well
    const drawnCard = room.gameState.deck.pop();
    if (drawnCard) {
      player.hand.push(drawnCard);
      if (room.gameState.deck.length === 0) {
        // Move current discard to pile before reshuffle
        room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
        room.gameState.currentTurnDiscard = [];
        const topCard = room.gameState.discardPile.pop()!;
        room.gameState.deck = shuffleDeck(room.gameState.discardPile);
        room.gameState.discardPile = [topCard];
      }
    }
    
    // Move current discard to pile
    if (room.gameState.currentTurnDiscard.length > 0) {
      room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
      room.gameState.currentTurnDiscard = [];
    }

    // Move to next turn
    let nextTurn = (room.gameState.turnIndex + 1) % room.players.length;
    while (room.players[nextTurn].isEliminated) {
      nextTurn = (nextTurn + 1) % room.players.length;
    }
    room.gameState.turnIndex = nextTurn;
    room.gameState.turnPhase = "discarding";
    room.gameState.lastAction = `${player.name} is away and auto-played`;
  } else {
    // Already discarded, just auto-draw from deck
    const drawnCard = room.gameState.deck.pop();
    if (drawnCard) {
      player.hand.push(drawnCard);
      if (room.gameState.deck.length === 0) {
        // Move current discard to pile before reshuffle
        room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
        room.gameState.currentTurnDiscard = [];
        const topCard = room.gameState.discardPile.pop()!;
        room.gameState.deck = shuffleDeck(room.gameState.discardPile);
        room.gameState.discardPile = [topCard];
      }
    }
    
    // Move current discard to pile
    if (room.gameState.currentTurnDiscard.length > 0) {
      room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
      room.gameState.currentTurnDiscard = [];
    }

    // Move to next turn
    let nextTurn = (room.gameState.turnIndex + 1) % room.players.length;
    while (room.players[nextTurn].isEliminated) {
      nextTurn = (nextTurn + 1) % room.players.length;
    }
    room.gameState.turnIndex = nextTurn;
    room.gameState.turnPhase = "discarding";
    room.gameState.lastAction = `${player.name} is away and auto-drew`;
  }

  io.to(roomId).emit("ROOM_UPDATED", room);
  await persistRoom(room);
  startTurnTimer(io, room);
}

async function handleBotTurn(io: Server, room: Room) {
  const bot = room.players[room.gameState.turnIndex];
  if (!bot || !bot.isBot || bot.isEliminated) return;

  console.log(`[Server] Bot ${bot.name} is thinking...`);
  
  // Wait based on config or default
  const baseThinkTime = room.config.botThinkTime || 1500;
  const thinkTime = baseThinkTime + Math.random() * 1500;
  
  setTimeout(async () => {
    // Re-verify it's still the bot's turn
    const currentRoom = await getRoom(room.id, io);
    if (!currentRoom || currentRoom.gameState.status !== "playing") return;
    const currentBot = currentRoom.players[currentRoom.gameState.turnIndex];
    if (!currentBot || currentBot.id !== bot.id) return;

    const getHandScore = (player: Player) => {
      return player.hand.reduce((sum, c) => {
        const isJoker = c.rank === "Joker" || (currentRoom.gameState.joker && c.rank === currentRoom.gameState.joker.rank);
        if (isJoker) {
          return sum + (currentRoom.config.jokerValue || 0);
        }
        return sum + c.value;
      }, 0);
    };

    const botScore = getHandScore(bot);

    // 1. Decide whether to declare Least Count (at start of turn)
    if (currentRoom.gameState.turnPhase === "discarding" && botScore <= currentRoom.config.callLimit) {
      let shouldDeclare = false;
      const difficulty = currentRoom.config.botDifficulty || "normal";

      if (difficulty === "easy") {
        shouldDeclare = botScore < 3 && Math.random() > 0.5;
      } else if (difficulty === "normal") {
        shouldDeclare = botScore < 4 || Math.random() > 0.3;
      } else if (difficulty === "hard") {
        shouldDeclare = botScore < 6 || Math.random() > 0.1;
      }

      if (shouldDeclare) {
        console.log(`[Server] Bot ${bot.name} declaring Least Count with score ${botScore}`);
        
        if (turnTimers.has(currentRoom.id)) {
          clearTimeout(turnTimers.get(currentRoom.id)!);
          turnTimers.delete(currentRoom.id);
        }

        let caughtBy: Player | null = null;
        let minCatcherScore = Infinity;

        currentRoom.players.forEach((p) => {
          if (p.id !== bot.id && !p.isEliminated) {
            const pScore = getHandScore(p);
            if (pScore <= botScore) {
              if (pScore < minCatcherScore) {
                minCatcherScore = pScore;
                caughtBy = p;
              } else if (pScore === minCatcherScore && !caughtBy) {
                caughtBy = p;
              }
            }
          }
        });

        await endRound(io, currentRoom, bot, caughtBy);
        io.to(currentRoom.id).emit("ROUND_ENDED", { room: currentRoom, caughtBy, declarer: bot });
        io.to(currentRoom.id).emit("ROOM_UPDATED", currentRoom);
        await persistRoom(currentRoom);
        return;
      }
    }

    // 2. Bot Discards
    if (currentRoom.gameState.turnPhase === "discarding") {
      const difficulty = currentRoom.config.botDifficulty || "normal";
      let bestGroup: Card[] = [];

      const topDiscard = currentRoom.gameState.discardPile[currentRoom.gameState.discardPile.length - 1];

      if (difficulty === "easy") {
        bestGroup = [bot.hand[Math.floor(Math.random() * bot.hand.length)]];
      } else {
        // Find sets
        const groups: Record<string, Card[]> = {};
        bot.hand.forEach(groupCard => {
          if (!groups[groupCard.rank]) groups[groupCard.rank] = [];
          groups[groupCard.rank].push(groupCard);
        });

        // Strategy: Prioritize matching the top discard if it's a single card
        const matchingCard = topDiscard ? bot.hand.find(c => c.rank === topDiscard.rank) : null;
        
        if (matchingCard && difficulty === "hard") {
          bestGroup = [matchingCard];
        } else {
          // Otherwise, find the highest value group or card
          const sortedHand = [...bot.hand].sort((a, b) => b.value - a.value);
          bestGroup = [sortedHand[0]];
          let maxVal = sortedHand[0].value;

          Object.values(groups).forEach(group => {
            const val = group.reduce((s, c) => s + c.value, 0);
            if (val > maxVal) {
              maxVal = val;
              bestGroup = group;
            }
          });
        }
      }

      const isMatch = bestGroup.length === 1 && topDiscard && bestGroup[0].rank === topDiscard.rank;

      bot.hand = bot.hand.filter(c => !bestGroup.some(bg => bg.suit === c.suit && bg.rank === c.rank));
      currentRoom.gameState.currentTurnDiscard = bestGroup;
      
      io.to(currentRoom.id).emit("CARD_PLAYED", { playerId: bot.id, cards: bestGroup });

      if (bot.hand.length === 0) {
        currentRoom.gameState.lastAction = `${bot.name} ran out of cards!`;
        // Move current discard to pile
        currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
        currentRoom.gameState.currentTurnDiscard = [];
        await endRound(io, currentRoom);
        return;
      }

      if (isMatch) {
        currentRoom.gameState.lastAction = `${bot.name} matched ${topDiscard.rank} and skipped drawing!`;
        // Move current discard to pile
        currentRoom.gameState.discardPile.push(...currentRoom.gameState.currentTurnDiscard);
        currentRoom.gameState.currentTurnDiscard = [];
        // Move to next turn immediately
        let nextTurn = (currentRoom.gameState.turnIndex + 1) % currentRoom.players.length;
        while (currentRoom.players[nextTurn].isEliminated) {
          nextTurn = (nextTurn + 1) % currentRoom.players.length;
        }
        currentRoom.gameState.turnIndex = nextTurn;
        currentRoom.gameState.turnPhase = "discarding";
        
        io.to(currentRoom.id).emit("ROOM_UPDATED", currentRoom);
        await persistRoom(currentRoom);
        startTurnTimer(io, currentRoom);
        return;
      }

      currentRoom.gameState.turnPhase = "drawing";
      currentRoom.gameState.lastAction = `${bot.name} discarded ${bestGroup.length} card(s)`;
      
      io.to(currentRoom.id).emit("ROOM_UPDATED", currentRoom);
      await persistRoom(currentRoom);

      // 3. Bot Draws (after a short delay)
      setTimeout(async () => {
        const updatedRoom = await getRoom(room.id, io);
        if (!updatedRoom || updatedRoom.gameState.status !== "playing" || updatedRoom.gameState.turnPhase !== "drawing") return;
        const updatedBot = updatedRoom.players[updatedRoom.gameState.turnIndex];
        if (!updatedBot || updatedBot.id !== bot.id) return;

        const topDiscard = updatedRoom.gameState.discardPile[updatedRoom.gameState.discardPile.length - 1];
        
        let source: "deck" | "discard" = "deck";
        // Bot strategy: draw from discard if it's a low card (<= 5)
        if (topDiscard && topDiscard.value <= 5) {
          source = "discard";
        }

        let drawnCard: Card | undefined;
        if (source === "deck") {
          drawnCard = updatedRoom.gameState.deck.pop();
          if (updatedRoom.gameState.deck.length === 0) {
            // Move current discard to pile before reshuffle
            updatedRoom.gameState.discardPile.push(...updatedRoom.gameState.currentTurnDiscard);
            updatedRoom.gameState.currentTurnDiscard = [];
            const top = updatedRoom.gameState.discardPile.pop()!;
            updatedRoom.gameState.deck = shuffleDeck(updatedRoom.gameState.discardPile);
            updatedRoom.gameState.discardPile = [top];
          }
        } else {
          // Draw from discard pile: take the card that was there BEFORE the bot discarded
          drawnCard = updatedRoom.gameState.discardPile.pop();
        }

        if (drawnCard) {
          updatedBot.hand.push(drawnCard);
          updatedRoom.gameState.lastAction = `${updatedBot.name} drew from ${source}`;
          
          // Move current discard to pile
          updatedRoom.gameState.discardPile.push(...updatedRoom.gameState.currentTurnDiscard);
          updatedRoom.gameState.currentTurnDiscard = [];

          // Move to next turn
          let nextTurn = (updatedRoom.gameState.turnIndex + 1) % updatedRoom.players.length;
          while (updatedRoom.players[nextTurn].isEliminated) {
            nextTurn = (nextTurn + 1) % updatedRoom.players.length;
          }
          updatedRoom.gameState.turnIndex = nextTurn;
          updatedRoom.gameState.turnPhase = "discarding";
          
          io.to(updatedRoom.id).emit("CARD_DRAWN", { playerId: updatedBot.id, source });
          io.to(updatedRoom.id).emit("ROOM_UPDATED", updatedRoom);
          await persistRoom(updatedRoom);
          startTurnTimer(io, updatedRoom);
        }
      }, 1500);
    }
  }, thinkTime);
}

async function handleBotDraw(io: Server, room: Room, bot: Player) {
  // Re-verify it's still the bot's turn and phase
  const currentRoom = await getRoom(room.id, io);
  if (!currentRoom || currentRoom.gameState.status !== "playing" || currentRoom.gameState.turnPhase !== "drawing") return;
  const currentBot = currentRoom.players[currentRoom.gameState.turnIndex];
  if (!currentBot || currentBot.id !== bot.id) return;

  // Strategy: If top discard is lower than current hand average or a specific threshold, draw it.
  const topDiscard = currentRoom.gameState.discardPile[currentRoom.gameState.discardPile.length - 1];
  
  let source: "deck" | "discard" = "deck";
  if (topDiscard && topDiscard.value < 5) {
    source = "discard";
  }

  let drawnCard: Card | undefined;
  if (source === "deck") {
    drawnCard = currentRoom.gameState.deck.pop();
    if (currentRoom.gameState.deck.length === 0) {
      const top = currentRoom.gameState.discardPile.pop()!;
      currentRoom.gameState.deck = shuffleDeck(currentRoom.gameState.discardPile);
      currentRoom.gameState.discardPile = [top];
    }
  } else {
    drawnCard = currentRoom.gameState.discardPile.pop();
  }

  if (drawnCard) {
    currentBot.hand.push(drawnCard);
    currentRoom.gameState.lastAction = `${currentBot.name} drew from ${source}`;
    
    io.to(currentRoom.id).emit("CARD_DRAWN", { playerId: currentBot.id, source });

    // Move to next turn
    let nextTurn = (currentRoom.gameState.turnIndex + 1) % currentRoom.players.length;
    while (currentRoom.players[nextTurn].isEliminated) {
      nextTurn = (nextTurn + 1) % currentRoom.players.length;
    }
    currentRoom.gameState.turnIndex = nextTurn;
    currentRoom.gameState.turnPhase = "discarding";
    
    io.to(currentRoom.id).emit("ROOM_UPDATED", currentRoom);
    await persistRoom(currentRoom);
    startTurnTimer(io, currentRoom);
  }
}

function createDeck(): Card[] {
  const suits: Card["suit"][] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      let value = parseInt(rank);
      if (rank === "A") value = 1;
      else if (["J", "Q", "K"].includes(rank)) value = 10;
      else if (isNaN(value)) value = 10;

      deck.push({ suit, rank, value });
    }
  }
  
  // Add 2 physical Jokers
  deck.push({ suit: "spades", rank: "Joker", value: 0 });
  deck.push({ suit: "hearts", rank: "Joker", value: 0 });
  
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

async function endRound(io: Server, room: Room, declarer?: Player, caughtBy?: Player | null) {
  const roundScores: { [playerId: string]: number } = {};
  
  // Calculate hand scores considering Joker
  const getHandScore = (player: Player) => {
    return player.hand.reduce((sum, c) => {
      const isJoker = c.rank === "Joker" || (room.gameState.joker && c.rank === room.gameState.joker.rank);
      if (isJoker) {
        return sum + (room.config.jokerValue || 0);
      }
      return sum + c.value;
    }, 0);
  };

  // Update scores
  room.players.forEach((p) => {
    if (!p.isEliminated) {
      const handScore = getHandScore(p);
      let roundScore = 0;

      if (declarer && p.id === declarer.id) {
        if (caughtBy) {
          let penalty = room.config.penaltyValue;
          if (room.config.doublePenaltyOnCatch) {
            penalty *= 2;
          }
          roundScore = penalty;
        } else {
          roundScore = 0; // Winner of round
        }
      } else if (caughtBy && p.id === caughtBy.id) {
        roundScore = 0; // Catcher wins the round (0 points)
      } else if (!declarer && p.hand.length === 0) {
        roundScore = 0; // Winner by 0 cards
      } else {
        roundScore = handScore;
      }

      p.score += roundScore;
      
      // Apply Score Reduction Rule
      if (room.config.scoreReductionRule === "half_on_50" && p.score === 50) {
        p.score = 25;
      } else if (room.config.scoreReductionRule === "half_on_100" && p.score === 100) {
        p.score = 50;
      }

      roundScores[p.id] = roundScore;
    } else {
      roundScores[p.id] = 0; // Eliminated players get 0 for the round
    }
  });

  // Check for elimination
  room.players.forEach((p) => {
    if (p.score >= room.config.eliminationLimit) {
      p.isEliminated = true;
    }
  });

  // Emit round stats for challenges/achievements
  io.to(room.id).emit("ROUND_OVER_STATS", {
    roundScores,
    declarerId: declarer?.id,
    caughtById: caughtBy?.id,
    players: room.players.map(p => ({ id: p.id, uid: p.uid, score: p.score, hand: p.hand }))
  });

  // Record history
  room.gameState.roundHistory.push({
    roundNumber: room.gameState.roundHistory.length + 1,
    scores: roundScores,
    eliminatedPlayers: room.players.filter(p => p.isEliminated).map(p => p.id),
  });

  const activePlayers = room.players.filter((p) => !p.isEliminated);
  if (activePlayers.length <= 1) {
    room.gameState.status = "game_over";
    room.gameState.winner = activePlayers[0]?.name || "No one";
    
    // Emit game over stats for achievements/challenges
    io.to(room.id).emit("GAME_OVER_STATS", {
      winnerId: activePlayers[0]?.id,
      winnerUid: activePlayers[0]?.uid,
      players: room.players.map(p => ({ id: p.id, uid: p.uid, score: p.score, isEliminated: p.isEliminated }))
    });

    if (turnTimers.has(room.id)) {
      clearTimeout(turnTimers.get(room.id)!);
      turnTimers.delete(room.id);
    }
    await persistRoom(room);
  } else {
    room.gameState.status = "round_end";
    
    // Start 10s countdown for next round
    room.gameState.nextRoundCountdown = 10;
    await persistRoom(room);
    resumeRoundEndTimer(io, room);
  }
}

function startNextRound(room: Room) {
  const deck = shuffleDeck(createDeck());
  room.players.forEach((player) => {
    if (!player.isEliminated) {
      player.hand = deck.splice(0, 7);
    } else {
      player.hand = [];
    }
  });

  const joker = deck.pop()!;

  // Determine starting player for this round
  let startingIdx = room.gameState.startingPlayerIndex ?? 0;
  
  // If this isn't the first round of the game, increment the starting player
  if (room.gameState.status !== "lobby") {
    startingIdx = (startingIdx + 1) % room.players.length;
  }

  let firstTurn = startingIdx;
  while (room.players[firstTurn].isEliminated) {
    firstTurn = (firstTurn + 1) % room.players.length;
  }

  room.gameState = {
    ...room.gameState,
    deck,
    discardPile: [deck.pop()!],
    currentTurnDiscard: [],
    turnIndex: firstTurn,
    startingPlayerIndex: startingIdx,
    turnPhase: "discarding",
    status: "playing",
    joker,
  };
  delete room.gameState.nextRoundCountdown;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 60000,
  });

  const distPath = path.join(process.cwd(), "dist");
  const indexPath = path.join(distPath, "index.html");
  const isProduction = fs.existsSync(indexPath);

  console.log(`[Server] Starting in ${isProduction ? "PRODUCTION" : "DEVELOPMENT"} mode`);

  // Health check route
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      mode: isProduction ? "production" : "development",
      time: new Date().toISOString()
    });
  });

  if (isProduction) {
    console.log("[Server] Serving static files from:", distPath);
    app.use(express.static(distPath));
    
    // SPA fallback - must be after express.static
    app.get("*", (req, res) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error("[Server] ERROR: index.html not found at", indexPath);
        res.status(404).send("Application build not found. Please wait for build to complete.");
      }
    });
  } else {
    console.log("[Server] Initializing Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("CREATE_ROOM", async ({ name, config, uid, playerId }: { name: string; config: RoomConfig; uid?: string; playerId: string }) => {
      const roomId = generateRoomId();
      console.log(`[Server] Creating room: ${roomId} for ${name} (uid: ${uid}, playerId: ${playerId})`);
      const room: Room = {
        id: roomId,
        players: [{ id: playerId, socketId: socket.id, uid, name, hand: [], score: 0, isHost: true, isEliminated: false, isBot: false }],
        spectators: [],
        config,
        gameState: {
          deck: [],
          discardPile: [],
          currentTurnDiscard: [],
          turnIndex: 0,
          startingPlayerIndex: 0,
          turnPhase: "discarding",
          status: "lobby",
          roundHistory: [],
        },
        chat: [],
      };
      rooms.set(roomId, room);
      socket.join(roomId);
      socket.emit("ROOM_CREATED", room);
      await persistRoom(room);
    });

    socket.on("UPDATE_CONFIG", async ({ roomId, config }: { roomId: string; config: RoomConfig }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) return;
      
      if (room.gameState.status !== "lobby") return;
      
      room.config = config;
      io.to(room.id).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("ADD_BOT", async (roomId: string) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) return;
      
      if (room.gameState.status !== "lobby") return;
      if (room.players.length >= room.config.maxPlayers) return;
      
      const botNames = ["AlphaBot", "BetaBot", "GammaBot", "DeltaBot", "ZetaBot", "OmegaBot", "SigmaBot", "ThetaBot"];
      const existingBotNames = room.players.filter(p => p.isBot).map(p => p.name);
      const availableNames = botNames.filter(n => !existingBotNames.includes(n));
      const botName = availableNames[0] || `Bot ${room.players.length + 1}`;
      
      const botPlayer: Player = {
        id: "bot_" + Math.random().toString(36).substring(2, 9),
        socketId: "bot",
        name: botName,
        hand: [],
        score: 0,
        isHost: false,
        isEliminated: false,
        isBot: true
      };
      
      room.players.push(botPlayer);
      io.to(room.id).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("REMOVE_BOT", async ({ roomId, botId }: { roomId: string; botId: string }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) return;
      
      if (room.gameState.status !== "lobby") return;
      
      const botIndex = room.players.findIndex(p => p.id === botId && p.isBot);
      if (botIndex !== -1) {
        room.players.splice(botIndex, 1);
        io.to(room.id).emit("ROOM_UPDATED", room);
        await persistRoom(room);
      }
    });

    socket.on("SEND_MESSAGE", async ({ roomId, text, playerId }: { roomId: string; text: string; playerId: string }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;

      const player = room.players.find(p => p.id === playerId);
      const spectator = room.spectators.find(s => s.id === playerId);
      
      if (!player && !spectator) return;

      const newMessage: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        playerId,
        playerName: player ? player.name : (spectator ? spectator.name : "Unknown"),
        text: text.trim().substring(0, 200),
        timestamp: Date.now(),
        isSpectator: !!spectator
      };

      room.chat.push(newMessage);
      // Keep only last 50 messages
      if (room.chat.length > 50) room.chat.shift();

      io.to(room.id).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("SEND_EMOJI", async ({ roomId, emoji, playerId }: { roomId: string; emoji: string; playerId: string }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;
      
      io.to(room.id).emit("EMOJI_RECEIVED", { playerId, emoji });
    });

    socket.on("USER_STATUS", async ({ uid, status }: { uid: string; status: 'online' | 'offline' | 'in-game' }) => {
      io.emit("FRIEND_STATUS_UPDATE", { uid, status });
    });

    socket.on("BACK_TO_GAME", async ({ roomId, playerId }: { roomId: string; playerId: string }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;

      const player = room.players.find(p => p.id === playerId);
      if (!player) return;

      player.isAway = false;
      io.to(room.id).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("JOIN_ROOM", async ({ roomId, name, uid, playerId }: { roomId: string; name: string; uid?: string; playerId: string }) => {
      const cleanId = roomId.trim().toUpperCase();
      console.log(`[Server] User ${name} (uid: ${uid}, playerId: ${playerId}) attempting to join room: ${cleanId}`);
      const room = await getRoom(cleanId, io);
      if (!room) {
        console.log(`[Server] Room ${cleanId} not found.`);
        return socket.emit("ERROR", "Room not found");
      }

      // Check for reconnection in players
      const existingPlayer = room.players.find(p => p.id === playerId);
      if (existingPlayer) {
        console.log(`[Server] Player ${name} reconnecting to room ${cleanId}`);
        existingPlayer.socketId = socket.id;
        existingPlayer.name = name; // Update name if changed
        if (uid) existingPlayer.uid = uid;
        socket.join(cleanId);
        io.to(cleanId).emit("ROOM_UPDATED", room);
        await persistRoom(room);
        return;
      }

      // Check for reconnection in spectators
      const existingSpectator = room.spectators.find(s => s.id === playerId);
      if (existingSpectator) {
        console.log(`[Server] Spectator ${name} reconnecting to room ${cleanId}`);
        existingSpectator.socketId = socket.id;
        existingSpectator.name = name;
        socket.join(cleanId);
        io.to(cleanId).emit("ROOM_UPDATED", room);
        await persistRoom(room);
        return;
      }

      if (room.players.length >= room.config.maxPlayers) {
        if (room.config.allowSpectators) {
          const newSpectator: Spectator = { id: playerId, socketId: socket.id, name };
          room.spectators.push(newSpectator);
          socket.join(cleanId);
          io.to(cleanId).emit("ROOM_UPDATED", room);
          await persistRoom(room);
          return;
        } else {
          return socket.emit("ERROR", "Room is full");
        }
      }

      if (room.gameState.status !== "lobby") {
        if (room.config.allowSpectators) {
          const newSpectator: Spectator = { id: playerId, socketId: socket.id, name };
          room.spectators.push(newSpectator);
          socket.join(cleanId);
          io.to(cleanId).emit("ROOM_UPDATED", room);
          await persistRoom(room);
          return;
        } else {
          return socket.emit("ERROR", "Game already in progress");
        }
      }

      const newPlayer: Player = { id: playerId, socketId: socket.id, uid, name, hand: [], score: 0, isHost: false, isEliminated: false, isBot: false };
      room.players.push(newPlayer);
      socket.join(cleanId);
      io.to(cleanId).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("RECONNECT", async ({ roomId, playerId }: { roomId: string; playerId: string }) => {
      const cleanId = roomId.trim().toUpperCase();
      console.log(`[Server] Reconnect attempt: Room ${cleanId}, Player ${playerId}`);
      const room = await getRoom(cleanId, io);
      if (!room) {
        console.log(`[Server] Reconnect failed: Room ${cleanId} not found`);
        return socket.emit("ERROR", "Room not found");
      }

      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        console.log(`[Server] Reconnect failed: Player ${playerId} not found in room ${cleanId}`);
        return socket.emit("ERROR", "Player not found in room");
      }

      player.socketId = socket.id;
      socket.join(cleanId);
      io.to(cleanId).emit("ROOM_UPDATED", room); // Notify everyone
      await persistRoom(room);
      console.log(`[Server] Player ${player.name} reconnected to room ${cleanId} with new socket ${socket.id}`);
    });

    socket.on("START_GAME", async (roomId: string) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room) return;
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player || !player.isHost) return;

      if (roomTimers.has(room.id)) {
        clearInterval(roomTimers.get(room.id)!);
        roomTimers.delete(room.id);
      }

      startNextRound(room);
      startTurnTimer(io, room);
      io.to(roomId.toUpperCase()).emit("GAME_STARTED", room);
      await persistRoom(room);
    });

    socket.on("EXIT_ROOM", async (roomId: string) => {
      const cleanId = roomId?.toUpperCase();
      const room = await getRoom(cleanId, io);
      if (room) {
        const playerIndex = room.players.findIndex((p) => p.socketId === socket.id);
        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          room.players.splice(playerIndex, 1);
          socket.leave(cleanId);
          
          if (room.players.length === 0 && room.spectators.length === 0) {
            rooms.delete(cleanId);
            await supabase.from('active_rooms').delete().eq('id', cleanId);
            if (turnTimers.has(cleanId)) {
              clearTimeout(turnTimers.get(cleanId)!);
              turnTimers.delete(cleanId);
            }
          } else {
            if (player.isHost && room.players[0]) {
              room.players[0].isHost = true;
            }
            
            // Handle game state if a player leaves during a game
            if (room.gameState.status === "playing") {
              if (room.players.length === 1) {
                // Only one player left, they win
                room.gameState.status = "game_over";
                room.gameState.winner = room.players[0].name;
                room.gameState.lastAction = `${player.name} left the game. ${room.players[0].name} wins by default!`;
                if (turnTimers.has(cleanId)) {
                  clearTimeout(turnTimers.get(cleanId)!);
                  turnTimers.delete(cleanId);
                }
              } else {
                // More than one player left, adjust turnIndex if needed
                if (playerIndex < room.gameState.turnIndex) {
                  room.gameState.turnIndex--;
                } else if (playerIndex === room.gameState.turnIndex) {
                  // The current player left, reset phase and start timer for the next player
                  if (room.gameState.currentTurnDiscard.length > 0) {
                    room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
                    room.gameState.currentTurnDiscard = [];
                  }
                  room.gameState.turnPhase = "discarding";
                  room.gameState.turnIndex = room.gameState.turnIndex % room.players.length;
                  startTurnTimer(io, room);
                }
                room.gameState.lastAction = `${player.name} left the game.`;
              }
            } else if (room.gameState.status === "round_end") {
              // If only one player left during round end, they win the whole game
              if (room.players.length === 1) {
                room.gameState.status = "game_over";
                room.gameState.winner = room.players[0].name;
                room.gameState.lastAction = `${player.name} left the game. ${room.players[0].name} wins by default!`;
                if (roomTimers.has(cleanId)) {
                  clearInterval(roomTimers.get(cleanId)!);
                  roomTimers.delete(cleanId);
                }
              }
            }
            
            io.to(cleanId).emit("ROOM_UPDATED", room);
            await persistRoom(room);
          }
        }

        const spectatorIndex = room.spectators.findIndex((s) => s.socketId === socket.id);
        if (spectatorIndex !== -1) {
          room.spectators.splice(spectatorIndex, 1);
          socket.leave(cleanId);
          if (room.players.length === 0 && room.spectators.length === 0) {
            rooms.delete(cleanId);
            await supabase.from('active_rooms').delete().eq('id', cleanId);
          } else {
            io.to(cleanId).emit("ROOM_UPDATED", room);
            await persistRoom(room);
          }
        }
      }
    });

    socket.on("CARD_ACTION", async ({ roomId, action, cards, source }: { roomId: string; action: "draw" | "discard"; cards?: Card[]; source?: "deck" | "discard" }) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room || room.gameState.status !== "playing") return;

      const playerIndex = room.players.findIndex((p) => p.socketId === socket.id);
      if (playerIndex !== room.gameState.turnIndex) return;

      const player = room.players[playerIndex];

      if (action === "discard" && cards && cards.length > 0) {
        if (room.gameState.turnPhase !== "discarding") {
          return socket.emit("ERROR", "You already discarded! You must draw a card.");
        }

        const topDiscard = room.gameState.discardPile[room.gameState.discardPile.length - 1];
        const isMatch = cards.length === 1 && topDiscard && cards[0].rank === topDiscard.rank;

        // Validation for multiple cards
        if (cards.length > 1) {
          // Check for set (same rank)
          const isSet = cards.every(c => c.rank === cards[0].rank);
          
          // Check for sequence (3+ same suit in order)
          const isSequence = (() => {
            if (cards.length < 3) return false;
            const sorted = [...cards].sort((a, b) => a.value - b.value);
            const sameSuit = sorted.every(c => c.suit === sorted[0].suit);
            if (!sameSuit) return false;
            for (let i = 0; i < sorted.length - 1; i++) {
              if (sorted[i+1].value !== sorted[i].value + 1) return false;
            }
            return true;
          })();

          if (!isSet && !isSequence) {
            return socket.emit("ERROR", "Invalid discard! Must be a set (same rank) or sequence (3+ same suit in order).");
          }
        }

        // Verify player actually has these cards
        const hasAllCards = cards.every(card => 
          player.hand.some(c => c.suit === card.suit && c.rank === card.rank)
        );
        if (!hasAllCards) return socket.emit("ERROR", "You don't have those cards!");

        // Remove cards from hand
        cards.forEach((card) => {
          const idx = player.hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
          if (idx !== -1) player.hand.splice(idx, 1);
        });

        // Add to current turn discard slot
        room.gameState.currentTurnDiscard = cards;
        
        io.to(roomId.toUpperCase()).emit("CARD_PLAYED", { playerId: player.id, cards });

        if (player.hand.length === 0) {
          room.gameState.lastAction = `${player.name} ran out of cards!`;
          // Move current discard to pile
          room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
          room.gameState.currentTurnDiscard = [];
          await endRound(io, room);
          return io.to(roomId.toUpperCase()).emit("ROUND_ENDED", { room });
        }

        if (isMatch) {
          room.gameState.lastAction = `${player.name} matched ${topDiscard.rank} and skipped drawing!`;
          // Move current discard to pile
          room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
          room.gameState.currentTurnDiscard = [];
          // Move to next turn immediately
          let nextTurn = (room.gameState.turnIndex + 1) % room.players.length;
          while (room.players[nextTurn].isEliminated) {
            nextTurn = (nextTurn + 1) % room.players.length;
          }
          room.gameState.turnIndex = nextTurn;
          room.gameState.turnPhase = "discarding";
          startTurnTimer(io, room);
        } else {
          room.gameState.lastAction = `${player.name} discarded ${cards.length} card(s)`;
          // Move to drawing phase (same turn)
          room.gameState.turnPhase = "drawing";
        }

      } else if (action === "draw" && source) {
        if (room.gameState.turnPhase !== "drawing") {
          return socket.emit("ERROR", "You must discard before drawing!");
        }

        let drawnCard: Card | undefined;
        if (source === "deck") {
          drawnCard = room.gameState.deck.pop();
          if (room.gameState.deck.length === 0) {
            // Reshuffle discard pile except top card
            const topCard = room.gameState.discardPile.pop()!;
            room.gameState.deck = shuffleDeck(room.gameState.discardPile);
            room.gameState.discardPile = [topCard];
          }
        } else {
          // Draw from discard pile: take the card that was there BEFORE the player discarded
          drawnCard = room.gameState.discardPile.pop();
        }

        if (drawnCard) {
          player.hand.push(drawnCard);
          room.gameState.lastAction = `${player.name} drew from ${source}`;
          
          // Move current discard to pile
          room.gameState.discardPile.push(...room.gameState.currentTurnDiscard);
          room.gameState.currentTurnDiscard = [];

          // Move to next turn
          let nextTurn = (room.gameState.turnIndex + 1) % room.players.length;
          while (room.players[nextTurn].isEliminated) {
            nextTurn = (nextTurn + 1) % room.players.length;
          }
          room.gameState.turnIndex = nextTurn;
          room.gameState.turnPhase = "discarding";
          
          io.to(roomId.toUpperCase()).emit("CARD_DRAWN", { playerId: player.id, source });
          startTurnTimer(io, room);
        }
      }

      io.to(roomId.toUpperCase()).emit("ROOM_UPDATED", room);
      await persistRoom(room);
    });

    socket.on("DECLARE_LEAST_COUNT", async (roomId: string) => {
      const room = await getRoom(roomId.toUpperCase(), io);
      if (!room || room.gameState.status !== "playing") return;

      const declarerIndex = room.players.findIndex((p) => p.socketId === socket.id);
      if (declarerIndex !== room.gameState.turnIndex) {
        return socket.emit("ERROR", "It's not your turn!");
      }
      if (room.gameState.turnPhase !== "discarding") {
        return socket.emit("ERROR", "You must declare Least Count at the start of your turn!");
      }

      const declarer = room.players[declarerIndex];
      
      const getHandScore = (player: Player) => {
        return player.hand.reduce((sum, c) => {
          const isJoker = c.rank === "Joker" || (room.gameState.joker && c.rank === room.gameState.joker.rank);
          if (isJoker) {
            return sum + (room.config.jokerValue || 0);
          }
          return sum + c.value;
        }, 0);
      };

      const declarerScore = getHandScore(declarer);

      if (declarerScore > room.config.callLimit) {
        return socket.emit("ERROR", `You need ${room.config.callLimit} or less to declare!`);
      }

      if (turnTimers.has(room.id)) {
        clearTimeout(turnTimers.get(room.id)!);
        turnTimers.delete(room.id);
      }

      // Check for "Catch"
      let caughtBy: Player | null = null;
      let minCatcherScore = Infinity;

      room.players.forEach((p) => {
        if (p.id !== declarer.id && !p.isEliminated) {
          const pScore = getHandScore(p);
          if (pScore <= declarerScore) {
            // Find the best catcher (lowest score)
            if (pScore < minCatcherScore) {
              minCatcherScore = pScore;
              caughtBy = p;
            } else if (pScore === minCatcherScore && !caughtBy) {
              caughtBy = p;
            }
          }
        }
      });

      await endRound(io, room, declarer, caughtBy);

      io.to(roomId.toUpperCase()).emit("ROUND_ENDED", { room, caughtBy, declarer });
      await persistRoom(room);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Handle player leaving room - but wait for potential reconnection
      rooms.forEach(async (room, roomId) => {
        const playerIndex = room.players.findIndex((p) => p.socketId === socket.id);
        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          
          // If in lobby, wait a bit before removing to allow for refresh/reconnect
          if (room.gameState.status === "lobby") {
            console.log(`[Server] Player ${player.name} disconnected from lobby. Waiting 5s for reconnect...`);
            setTimeout(async () => {
              const currentRoom = await getRoom(roomId, io);
              if (currentRoom && currentRoom.gameState.status === "lobby") {
                const p = currentRoom.players.find(p => p.id === player.id);
                // Only remove if they haven't reconnected (socketId would be different)
                if (p && p.socketId === socket.id) {
                  const idx = currentRoom.players.findIndex(p => p.id === player.id);
                  if (idx !== -1) {
                    currentRoom.players.splice(idx, 1);
                    console.log(`[Server] Removed ${player.name} from lobby ${roomId} after timeout`);
                    if (currentRoom.players.length === 0 && currentRoom.spectators.length === 0) {
                      rooms.delete(roomId);
                      await supabase.from('active_rooms').delete().eq('id', roomId);
                    } else {
                      if (player.isHost && currentRoom.players[0]) currentRoom.players[0].isHost = true;
                      io.to(roomId).emit("ROOM_UPDATED", currentRoom);
                      await persistRoom(currentRoom);
                    }
                  }
                }
              }
            }, 5000);
          } else {
            // In game, don't remove, just wait for reconnect
            console.log(`[Server] Player ${player.name} disconnected during game. Waiting for reconnect...`);
          }
        }

        const spectatorIndex = room.spectators.findIndex((s) => s.socketId === socket.id);
        if (spectatorIndex !== -1) {
          const spectator = room.spectators[spectatorIndex];
          console.log(`[Server] Spectator ${spectator.name} disconnected. Waiting 5s for reconnect...`);
          setTimeout(async () => {
            const currentRoom = await getRoom(roomId, io);
            if (currentRoom) {
              const s = currentRoom.spectators.find(s => s.id === spectator.id);
              if (s && s.socketId === socket.id) {
                const idx = currentRoom.spectators.findIndex(s => s.id === spectator.id);
                if (idx !== -1) {
                  currentRoom.spectators.splice(idx, 1);
                  console.log(`[Server] Removed spectator ${spectator.name} from room ${roomId} after timeout`);
                  if (currentRoom.players.length === 0 && currentRoom.spectators.length === 0) {
                    rooms.delete(roomId);
                    await supabase.from('active_rooms').delete().eq('id', roomId);
                  } else {
                    io.to(roomId).emit("ROOM_UPDATED", currentRoom);
                    await persistRoom(currentRoom);
                  }
                }
              }
            }
          }, 5000);
        }
      });
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
