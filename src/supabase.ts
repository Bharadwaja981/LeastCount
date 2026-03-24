import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlockedAt: string;
  icon: string;
}

export interface DailyChallenge {
  id: string;
  type: 'games_played' | 'win_with_joker' | 'clean_sweep';
  goal: number;
  current: number;
  completed: boolean;
  reward: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  lastPlayed: string;
  role?: 'admin' | 'user';
  following?: string[];
  achievements?: Achievement[];
  dailyChallenges?: {
    lastReset: string;
    challenges: DailyChallenge[];
  };
  status?: 'online' | 'offline' | 'in-game';
  lastSeen?: string;
}

export interface MatchHistory {
  matchId: string;
  players: string[];
  winner: string;
  scores: { [playerName: string]: number };
  roundHistory?: { roundNumber: number; scores: { [playerName: string]: number }; eliminatedPlayers?: string[] }[];
  timestamp: string;
  participants: string[];
}

export const signInWithGoogle = async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  return data.url;
};

export const logout = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    console.error("Error during normal signout, forcing local signout:", err);
    await supabase.auth.signOut({ scope: 'local' });
  }
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase.from('users').select('*').eq('uid', uid).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('Error fetching user profile:', error);
    return null;
  }
  return {
    ...data,
    displayName: data.display_name,
    photoURL: data.photo_url,
    gamesPlayed: data.games_played,
    lastPlayed: data.last_played,
    dailyChallenges: data.daily_challenges,
    lastSeen: data.last_seen
  } as UserProfile;
};

function generateDailyChallenges(): DailyChallenge[] {
  return [
    { id: 'play_3', type: 'games_played', goal: 3, current: 0, completed: false, reward: 50 },
    { id: 'win_joker', type: 'win_with_joker', goal: 1, current: 0, completed: false, reward: 100 },
    { id: 'sweep_1', type: 'clean_sweep', goal: 1, current: 0, completed: false, reward: 150 },
  ];
}

export const createUserProfile = async (user: any) => {
  const { data: existingUser } = await supabase.from('users').select('*').eq('uid', user.id).maybeSingle();
  
  if (!existingUser) {
    const newProfile = {
      uid: user.id,
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || 'Anonymous',
      photo_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
      games_played: 0,
      wins: 0,
      losses: 0,
      last_played: new Date().toISOString(),
      role: 'user',
      following: [],
      achievements: [],
      daily_challenges: {
        lastReset: new Date().toISOString(),
        challenges: generateDailyChallenges()
      },
      status: 'online',
      last_seen: new Date().toISOString()
    };
    
    const { data, error } = await supabase.from('users').insert(newProfile).select().single();
    if (error) throw error;
    
    return {
      ...data,
      displayName: data.display_name,
      photoURL: data.photo_url,
      gamesPlayed: data.games_played,
      lastPlayed: data.last_played,
      dailyChallenges: data.daily_challenges,
      lastSeen: data.last_seen
    } as UserProfile;
  } else {
    const newName = user.user_metadata?.full_name || user.user_metadata?.name;
    const newPhoto = user.user_metadata?.avatar_url || user.user_metadata?.picture;
    
    const updateData: any = {
      status: 'online',
      last_seen: new Date().toISOString()
    };
    
    if (existingUser.display_name === 'Anonymous' && newName) {
      updateData.display_name = newName;
      existingUser.display_name = newName;
    }
    
    if (!existingUser.photo_url && newPhoto) {
      updateData.photo_url = newPhoto;
      existingUser.photo_url = newPhoto;
    }

    await supabase.from('users').update(updateData).eq('uid', user.id);
    
    return {
      ...existingUser,
      displayName: existingUser.display_name,
      photoURL: existingUser.photo_url,
      gamesPlayed: existingUser.games_played,
      lastPlayed: existingUser.last_played,
      dailyChallenges: existingUser.daily_challenges,
      lastSeen: existingUser.last_seen
    } as UserProfile;
  }
};

export const updateStatsAfterGame = async (uid: string, isWin: boolean) => {
  const { data: user } = await supabase.from('users').select('*').eq('uid', uid).single();
  if (user) {
    await supabase.from('users').update({
      games_played: user.games_played + 1,
      wins: isWin ? user.wins + 1 : user.wins,
      losses: isWin ? user.losses : user.losses + 1,
      last_played: new Date().toISOString(),
    }).eq('uid', uid);
  }
};

export const saveMatchHistory = async (match: MatchHistory) => {
  const { error } = await supabase.from('matches').upsert({
    match_id: match.matchId,
    players: match.players,
    winner: match.winner,
    scores: match.scores,
    round_history: match.roundHistory,
    timestamp: new Date().toISOString(),
    participants: match.participants
  });
  if (error) console.error('Error saving match history:', error);
};

export const getLeaderboard = async (limitCount: number = 10): Promise<UserProfile[]> => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('wins', { ascending: false })
    .order('games_played', { ascending: true })
    .limit(limitCount);
    
  if (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
  
  return data.map(d => ({
    ...d,
    displayName: d.display_name,
    photoURL: d.photo_url,
    gamesPlayed: d.games_played,
    lastPlayed: d.last_played,
    dailyChallenges: d.daily_challenges,
    lastSeen: d.last_seen
  })) as UserProfile[];
};

export const getRecentMatches = async (uid: string, limitCount: number = 10): Promise<MatchHistory[]> => {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .contains('participants', [uid])
    .order('timestamp', { ascending: false })
    .limit(limitCount);
    
  if (error) {
    console.error('Error fetching recent matches:', error);
    return [];
  }
  
  return data.map(d => ({
    matchId: d.match_id,
    players: d.players,
    winner: d.winner,
    scores: d.scores,
    roundHistory: d.round_history,
    timestamp: d.timestamp,
    participants: d.participants
  })) as MatchHistory[];
};

export const getUserRank = async (wins: number, gamesPlayed: number): Promise<number> => {
  const { data, error } = await supabase
    .from('users')
    .select('wins, games_played')
    .order('wins', { ascending: false })
    .order('games_played', { ascending: true });
    
  if (error || !data) return 0;
  
  const rank = data.findIndex(u => u.wins < wins || (u.wins === wins && u.games_played >= gamesPlayed));
  return rank === -1 ? data.length + 1 : rank + 1;
};

export const followUser = async (currentUid: string, targetUid: string) => {
  const { data: user } = await supabase.from('users').select('following').eq('uid', currentUid).single();
  if (user) {
    const following = user.following || [];
    if (!following.includes(targetUid)) {
      await supabase.from('users').update({ following: [...following, targetUid] }).eq('uid', currentUid);
    }
  }
};

export const unfollowUser = async (currentUid: string, targetUid: string) => {
  const { data: user } = await supabase.from('users').select('following').eq('uid', currentUid).single();
  if (user) {
    const following = user.following || [];
    await supabase.from('users').update({ following: following.filter((id: string) => id !== targetUid) }).eq('uid', currentUid);
  }
};

export const getFollowingProfiles = async (uids: string[]): Promise<UserProfile[]> => {
  if (!uids || uids.length === 0) return [];
  const { data, error } = await supabase.from('users').select('*').in('uid', uids);
  if (error) return [];
  
  return data.map(d => ({
    ...d,
    displayName: d.display_name,
    photoURL: d.photo_url,
    gamesPlayed: d.games_played,
    lastPlayed: d.last_played,
    dailyChallenges: d.daily_challenges,
    lastSeen: d.last_seen
  })) as UserProfile[];
};

const ACHIEVEMENTS_LIST = [
  { id: 'first_win', name: 'First Win', description: 'Win your first game', icon: '🏆' },
  { id: 'comeback_king', name: 'Comeback King', description: 'Win after being at 90+ points', icon: '👑' },
  { id: 'clean_sweep', name: 'Clean Sweep', description: 'Win a round with 0 points', icon: '🧹' },
  { id: 'joker_master', name: 'Joker Master', description: 'Win a game with a Joker in hand', icon: '🃏' },
];

export const unlockAchievement = async (uid: string, achievementId: string) => {
  const { data: user } = await supabase.from('users').select('achievements').eq('uid', uid).single();
  if (user) {
    const achievements = user.achievements || [];
    if (!achievements.some((a: any) => a.id === achievementId)) {
      const achievementInfo = ACHIEVEMENTS_LIST.find(a => a.id === achievementId);
      if (achievementInfo) {
        const newAchievement = {
          ...achievementInfo,
          unlockedAt: new Date().toISOString()
        };
        await supabase.from('users').update({ achievements: [...achievements, newAchievement] }).eq('uid', uid);
        return newAchievement;
      }
    }
  }
  return null;
};

export const updateDailyChallenges = async (uid: string, type: DailyChallenge['type'], increment: number = 1) => {
  const { data: user } = await supabase.from('users').select('daily_challenges').eq('uid', uid).single();
  if (user) {
    let daily = user.daily_challenges;
    const now = new Date();
    const lastReset = daily?.lastReset ? new Date(daily.lastReset) : new Date(0);
    
    if (now.toDateString() !== lastReset.toDateString()) {
      daily = {
        lastReset: new Date().toISOString(),
        challenges: generateDailyChallenges()
      };
    }

    if (daily) {
      const updatedChallenges = daily.challenges.map((c: any) => {
        if (c.type === type && !c.completed) {
          const newCurrent = c.current + increment;
          return {
            ...c,
            current: newCurrent,
            completed: newCurrent >= c.goal
          };
        }
        return c;
      });

      await supabase.from('users').update({
        daily_challenges: {
          ...daily,
          challenges: updatedChallenges
        }
      }).eq('uid', uid);
    }
  }
};

export const updateUserStatus = async (uid: string, status: 'online' | 'offline' | 'in-game') => {
  await supabase.from('users').update({
    status,
    last_seen: new Date().toISOString()
  }).eq('uid', uid);
};
