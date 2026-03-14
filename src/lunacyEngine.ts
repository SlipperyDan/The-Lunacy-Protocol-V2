import { GoogleGenAI, Type } from "@google/genai";
import { getMatchDetails, getMatchTimeline } from "./riot.js";

// --- PROTOCOL NOTATIONS ---

/**
 * TOON: Tactical Object-Oriented Notation
 * Optimized formatter with depth limiting to prevent stack overflows.
 */
const convertToTOON = (obj: any, indent = 0, depth = 0): string => {
    const spacing = "  ".repeat(indent);
    if (depth > 5) return "... [MAX_DEPTH]";
    if (obj === null || obj === undefined) return "NULL";
    if (typeof obj !== 'object') return String(obj);
    
    if (Array.isArray(obj)) {
        if (obj.length === 0) return "[]";
        const items = obj.slice(0, 50).map(item => spacing + "  " + convertToTOON(item, indent + 1, depth + 1));
        if (obj.length > 50) items.push(spacing + "  ... [TRUNCATED]");
        return "[\n" + items.join(",\n") + "\n" + spacing + "]";
    }

    const entries = Object.entries(obj);
    if (entries.length === 0) return "{}";
    
    const type = obj.type || obj.participantId || "OBJ";
    const body = entries
        .slice(0, 100)
        .filter(([k]) => k !== 'type' && typeof obj[k] !== 'function')
        .map(([k, v]) => `${spacing}  ${k.toUpperCase()}: ${convertToTOON(v, indent + 1, depth + 1)};`)
        .join("\n");
        
    return `[${type}]\n${spacing}{\n${body}\n${spacing}}`;
};

/**
 * Rift Coordinate Mapper
 * Translates raw (x, y) into tactical landmarks.
 */
const getRiftLocation = (x: number, y: number): string => {
    if (x < 1500 && y < 1500) return "BLUE FOUNTAIN";
    if (x > 13500 && y > 13500) return "RED FOUNTAIN";
    
    // River Detection (Roughly the diagonal from top-left to bottom-right)
    // Line: y = -x + 15000. River is a band around this.
    const riverDist = Math.abs(x + y - 15000) / Math.sqrt(2);
    if (riverDist < 1200) {
        if (x < 6000) return "TOP RIVER";
        if (x > 9000) return "BOT RIVER";
        if (x > 4000 && x < 6000 && y > 8000 && y < 11000) return "BARON PIT";
        if (x > 9000 && x < 11000 && y > 4000 && y < 6000) return "DRAGON PIT";
        return "MID RIVER";
    }

    // Lane Detection
    if (x < 2500 || y > 12500) return "TOP LANE";
    if (x > 12500 || y < 2500) return "BOT LANE";
    
    // Mid Lane (Diagonal y = x)
    const midDist = Math.abs(x - y) / Math.sqrt(2);
    if (midDist < 1000) return "MID LANE";

    // Jungle
    if (x + y < 15000) return "BLUE JUNGLE";
    return "RED JUNGLE";
};

/**
 * Tactical Phase Classifier
 */
const getTacticalPhase = (t: number, eventType: string, deltaP: number): string => {
    if (eventType.includes("ELITE MONSTER") || eventType.includes("BARON") || eventType.includes("DRAGON")) return "OBJECTIVE";
    if (eventType.includes("BUILDING") || eventType.includes("TURRET")) return "SIEGE";
    if (t < 12) return "LANING";
    if (Math.abs(deltaP) > 0.05) return "TEAMFIGHT";
    return "SKIRMISH";
};

/**
 * TRON: Tactical Real-time Object Notation
 * Stream-oriented formatter for the UI.
 */
const convertToTRON = (row: any): string => {
    const time = row.preciseTime || `${String(row.t).padStart(2, '0')}:00`;
    const event = String(row.eventName).padEnd(18);
    const state = row.cognitiveState ? ` | COG_STATE: ${row.cognitiveState}` : "";
    return `T+${time} | [${event}] @ ${row.context.padEnd(15)} | ${row.outcome} | PHASE: ${row.zone.padEnd(10)} | PROB: ${row.winProb}${state}`;
};

const calculateWinProbability = (team1Val: number, team2Val: number) => {
    if (team1Val === 0 && team2Val === 0) return 0.5;
    return team1Val / (team1Val + team2Val);
};

let itemMapCache: Record<string, string> | null = null;
const getItemMap = async () => {
    if (itemMapCache) return itemMapCache;
    try {
        const vRes = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
        const versions: any = await vRes.json();
        const latest = versions[0];
        const iRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/item.json`);
        const iData: any = await iRes.json();
        const map: Record<string, string> = {};
        for (const [id, item] of Object.entries(iData.data as any)) {
            map[id] = (item as any).name;
        }
        itemMapCache = map;
        return map;
    } catch (e) {
        console.error("Failed to fetch DDragon items", e);
        return {};
    }
};

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const analyzeAudioCognitiveState = async (audioBuffer: Buffer, durationMinutes: number, mimeType: string = "audio/mpeg"): Promise<Record<string, any>> => {
    if (!ai) {
        console.warn("Gemini API Key missing - skipping audio analysis");
        return {};
    }

    try {
        const base64Audio = audioBuffer.toString("base64");
        
        const prompt = `
        ANALYSIS PROTOCOL: LUNACY_FORENSIC_AUDIO
        MATCH_DURATION: ${Math.ceil(durationMinutes)}m
        
        TASK:
        1. Analyze the player's cognitive state per minute.
        2. Identify specific tactical strategies or thoughts expressed.
        
        OUTPUT_FORMAT: JSON
        SCHEMA: { "minute": { "state": "STRING", "thought": "STRING" } }
        
        IMPORTANT: The "minute" key must be the integer number of the minute (e.g., "0", "1", "2").
        
        STATES: FOCUSED, TILTED, FLOW, HESITANT, CONFIDENT, PANIC, NEUTRAL.
        THOUGHTS: Brief summary of strategy or intent.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
                parts: [
                    { inlineData: { mimeType, data: base64Audio } },
                    { text: prompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    additionalProperties: {
                        type: Type.OBJECT,
                        properties: {
                            state: { type: Type.STRING },
                            thought: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        const jsonText = response.text;
        if (!jsonText) return {};
        const cleanJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        const rawData = JSON.parse(cleanJson);
        
        // NORMALIZATION LAYER: Ensure keys are simple minute strings
        const normalized: Record<string, any> = {};
        Object.entries(rawData).forEach(([key, value]) => {
            const minuteMatch = key.match(/\d+/);
            if (minuteMatch) {
                normalized[minuteMatch[0]] = value;
            }
        });
        return normalized;
    } catch (error) {
        console.error("Audio analysis failed:", error);
        return {};
    }
};

const analyzeTranscriptCognitiveState = async (transcript: string): Promise<Record<string, any>> => {
    if (!ai) {
        console.warn("Gemini API Key missing - skipping transcript analysis");
        return {};
    }

    try {
        const prompt = `
        ANALYSIS PROTOCOL: LUNACY_FORENSIC_TRANSCRIPT
        
        TASK:
        1. Analyze the player's cognitive state per minute based on the provided transcript.
        2. The transcript contains lines like "[MM:SS] text".
        3. Identify specific tactical strategies or thoughts expressed.
        
        TRANSCRIPT:
        ${transcript}
        
        OUTPUT_FORMAT: JSON
        SCHEMA: { "minute": { "state": "STRING", "thought": "STRING" } }
        
        IMPORTANT: The "minute" key must be the integer number of the minute (e.g., "0", "1", "2").
        
        STATES: FOCUSED, TILTED, FLOW, HESITANT, CONFIDENT, PANIC, NEUTRAL.
        THOUGHTS: Brief summary of strategy or intent.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    additionalProperties: {
                        type: Type.OBJECT,
                        properties: {
                            state: { type: Type.STRING },
                            thought: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        const jsonText = response.text;
        if (!jsonText) return {};
        const cleanJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        const rawData = JSON.parse(cleanJson);
        
        const normalized: Record<string, any> = {};
        Object.entries(rawData).forEach(([key, value]) => {
            const minuteMatch = key.match(/\d+/);
            if (minuteMatch) {
                normalized[minuteMatch[0]] = value;
            }
        });
        return normalized;
    } catch (error) {
        console.error("Transcript analysis failed:", error);
        return {};
    }
};

const getTeamStatsAtMinute = (frames: any[], minute: number) => {
    const frame = frames[Math.min(minute, frames.length - 1)];
    if (!frame) return { t1Gold: 0, t2Gold: 0, t1Xp: 0, t2Xp: 0 };

    let t1Gold = 0, t2Gold = 0, t1Xp = 0, t2Xp = 0;

    for (let i = 1; i <= 5; i++) {
        const p = frame.participantFrames[i.toString()];
        if (p) {
            t1Gold += p.totalGold;
            t1Xp += p.xp;
        }
    }
    for (let i = 6; i <= 10; i++) {
        const p = frame.participantFrames[i.toString()];
        if (p) {
            t2Gold += p.totalGold;
            t2Xp += p.xp;
        }
    }

    return { t1Gold, t2Gold, t1Xp, t2Xp };
};

const calculateScores = (events: any[], participantId: number, startTime: number, endTime: number) => {
    const windowEvents = events.filter((e: any) => e.timestamp >= startTime && e.timestamp < endTime);
    
    let posScore = 0;
    let negScore = 0;

    windowEvents.forEach((e: any) => {
        if (e.type === "CHAMPION_KILL") {
            if (e.killerId === participantId) posScore += 1.0;
            else if (e.assistingParticipantIds && e.assistingParticipantIds.includes(participantId)) posScore += 0.5;
            
            if (e.victimId === participantId) negScore += 1.0;
        }
        if (e.type === "ELITE_MONSTER_KILL" || e.type === "BUILDING_KILL" || e.type === "TURRET_PLATE_DESTROYED") {
             if (e.killerId === participantId) posScore += 1.5;
             else if (e.assistingParticipantIds && e.assistingParticipantIds.includes(participantId)) posScore += 0.75;
        }
    });

    return { posScore, negScore };
};

export const generateForensicData = async (matchId: string, targetPuuid: string, region: string = "americas", audioBuffer?: Buffer, audioMimeType?: string, transcript?: string) => {
    const match = await getMatchDetails(matchId, region);
    const timeline = await getMatchTimeline(matchId, region);
    console.log(`[DEBUG] Timeline fetched: ${!!timeline}`);
    if (timeline && timeline.info) {
        console.log(`[DEBUG] Frames count: ${timeline.info.frames?.length || 0}`);
    } else {
        console.log(`[DEBUG] Timeline info missing`);
    }

    if (!match || !timeline) throw new Error("MATCH_DATA_MISSING");

    const participant = match.info.participants.find((p: any) => p.puuid === targetPuuid);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");

    const pId = participant.participantId;
    const teamId = participant.teamId;
    const isTeam1 = teamId === 100;

    const durationMin = match.info.gameDuration / 60;
    
    const getRole = (p: any) => {
        let role = p.teamPosition || p.lane || "FLEX";
        if (role === "UTILITY") role = "SUPPORT";
        if (role === "BOTTOM") role = "ADC";
        if (role === "MIDDLE") role = "MID";
        return role;
    };

    const playerRole = getRole(participant);
    const allies: string[] = [];
    const enemies: string[] = [];
    
    let teamTotalDamageDealt = 0;
    let teamTotalDamageTaken = 0;
    let teamTotalDamageToTowers = 0;

    match.info.participants.forEach((p: any) => {
        const roleStr = `${getRole(p)}: ${p.championName}`;
        if (p.teamId === teamId) {
            teamTotalDamageDealt += p.totalDamageDealtToChampions || 0;
            teamTotalDamageTaken += p.totalDamageTaken || 0;
            teamTotalDamageToTowers += p.damageDealtToBuildings || p.damageDealtToTurrets || 0;
            
            if (p.puuid !== targetPuuid) allies.push(roleStr);
        } else {
            enemies.push(roleStr);
        }
    });

    const damageShare = teamTotalDamageDealt > 0 ? ((participant.totalDamageDealtToChampions / teamTotalDamageDealt) * 100).toFixed(1) + "%" : "0.0%";
    const tankShare = teamTotalDamageTaken > 0 ? ((participant.totalDamageTaken / teamTotalDamageTaken) * 100).toFixed(1) + "%" : "0.0%";
    const towerShare = teamTotalDamageToTowers > 0 ? (((participant.damageDealtToBuildings || participant.damageDealtToTurrets || 0) / teamTotalDamageToTowers) * 100).toFixed(1) + "%" : "0.0%";

    const meta = {
        matchId: match.metadata.matchId,
        identity: `${participant.riotIdGameName} #${participant.riotIdTagline}`,
        champion: participant.championName,
        role: playerRole,
        allies: allies.join(" | "),
        enemies: enemies.join(" | "),
        duration: `${Math.floor(durationMin)}:${(match.info.gameDuration % 60).toString().padStart(2, '0')}`
    };

    const champMap: Record<number, string> = {};
    match.info.participants.forEach((p: any) => {
        champMap[p.participantId] = p.championName;
    });

    let cognitiveData: Record<string, any> = {};
    if (transcript) {
        cognitiveData = await analyzeTranscriptCognitiveState(transcript);
    } else if (audioBuffer) {
        cognitiveData = await analyzeAudioCognitiveState(audioBuffer, durationMin, audioMimeType);
    }

    const csPerMin = (min: number) => {
        if (!timeline.info || !timeline.info.frames || min === 0) return "0.0";
        const frame = timeline.info.frames[min];
        if (!frame) return "N/A";
        const pFrame = frame.participantFrames[pId.toString()];
        return pFrame ? ((pFrame.minionsKilled + pFrame.jungleMinionsKilled) / min).toFixed(1) : "0.0";
    };

    const stats = {
        kda: `${participant.kills}/${participant.deaths}/${participant.assists}`,
        goldPerMin: (participant.goldEarned / durationMin).toFixed(0),
        csMin5: csPerMin(5),
        csMin10: csPerMin(10),
        csMin15: csPerMin(15),
        csMin20: csPerMin(20),
        csMinTotal: ((participant.totalMinionsKilled + participant.neutralMinionsKilled) / durationMin).toFixed(1),
        totalDamage: participant.totalDamageDealtToChampions.toLocaleString(),
        damageShare: "0%",
        tankShare: "0%",
        towerShare: "0%",
        slaughterVelocity: "0",
        peakVelocity: "0",
        bleedRate: "0",
        catalystScore: "0",
        agencyRatio: "0%"
    };

    let totalSlaughterVelocity = 0;
    let peakVelocity = 0;
    let bleedRate = 0;
    let catalystScore = 0;
    let totalMyContribution = 0;
    let totalTeamContributionSum = 0;

    const telemetryRows: any[] = [];
    const progressionRows: any[] = [];
    const tronStream: string[] = [];

    const frames = timeline.info?.frames || [];
    const itemMap = await getItemMap();
    
    const winProbs: number[] = [];
    console.log(`[DEBUG] Frames length: ${frames.length}`);
    for (let i = 0; i < frames.length; i++) {
        const { t1Gold, t2Gold, t1Xp, t2Xp } = getTeamStatsAtMinute(frames, i);
        const pGold = calculateWinProbability(t1Gold, t2Gold);
        const pXp = calculateWinProbability(t1Xp, t2Xp);
        let p1 = (pGold + pXp) / 2;
        if (!isTeam1) p1 = 1 - p1;
        winProbs.push(p1);
    }
    console.log(`[DEBUG] WinProbs length: ${winProbs.length}`);

    for (let i = 0; i < frames.length - 1; i++) {
        const t = i;
        const pCurrent = winProbs[t];
        const pNext = winProbs[t+1];
        const deltaP = pNext - pCurrent;
        
        let totalTeamContribution = 0;
        let myContribution = 0;
        
        const startMs = t * 60 * 1000;
        const endMs = (t + 1) * 60 * 1000;
        const events = frames[t+1].events;

        const teamStart = isTeam1 ? 1 : 6;
        const teamEnd = isTeam1 ? 5 : 10;
        const teamIds = Array.from({length: 5}, (_, i) => teamStart + i);

        let teamPosScore = 0;
        let teamNegScore = 0;
        let myPosScore = 0;
        let myNegScore = 0;

        for (const k of teamIds) {
            const { posScore, negScore } = calculateScores(events, k, startMs, endMs);
            teamPosScore += posScore;
            teamNegScore += negScore;
            if (k === pId) {
                myPosScore = posScore;
                myNegScore = negScore;
            }
        }

        let authoredImpact = 0;

        if (deltaP > 0) {
            let weight = 0;
            if (teamPosScore > 0) {
                weight = myPosScore / teamPosScore;
            } else {
                const myGoldGained = frames[t+1].participantFrames[pId.toString()].totalGold - frames[t].participantFrames[pId.toString()].totalGold;
                let teamGoldGained = 0;
                for (const k of teamIds) {
                    teamGoldGained += frames[t+1].participantFrames[k.toString()].totalGold - frames[t].participantFrames[k.toString()].totalGold;
                }
                weight = teamGoldGained > 0 ? Math.max(0, myGoldGained) / teamGoldGained : 0.2;
            }
            authoredImpact = deltaP * weight;
        } else if (deltaP < 0) {
            let weight = 0;
            if (teamNegScore > 0) {
                weight = myNegScore / teamNegScore;
            } else {
                const myGoldGained = frames[t+1].participantFrames[pId.toString()].totalGold - frames[t].participantFrames[pId.toString()].totalGold;
                let maxGoldGained = 0;
                const goldGains: Record<number, number> = {};
                for (const k of teamIds) {
                    const gained = frames[t+1].participantFrames[k.toString()].totalGold - frames[t].participantFrames[k.toString()].totalGold;
                    goldGains[k] = gained;
                    if (gained > maxGoldGained) maxGoldGained = gained;
                }
                
                let totalBlame = 0;
                for (const k of teamIds) {
                    totalBlame += Math.max(0, maxGoldGained - goldGains[k]);
                }
                
                if (totalBlame > 0) {
                    weight = Math.max(0, maxGoldGained - myGoldGained) / totalBlame;
                } else {
                    weight = 0.2;
                }
            }
            authoredImpact = deltaP * weight;
        }
        
        totalSlaughterVelocity += authoredImpact;
        totalMyContribution += myPosScore;
        totalTeamContributionSum += teamPosScore;
        
        if (authoredImpact > peakVelocity) peakVelocity = authoredImpact;
        if (authoredImpact > 0) catalystScore += authoredImpact;
        if (authoredImpact < 0) bleedRate += authoredImpact;

        // WIDE TELEMETRY: Capture all events involving the player
        const playerEvents = events.filter((e: any) => 
            e.participantId === pId || 
            e.killerId === pId || 
            e.victimId === pId || 
            (e.assistingParticipantIds && e.assistingParticipantIds.includes(pId)) ||
            e.creatorId === pId
        );

        const cognitive = cognitiveData[t.toString()] || { state: "NEUTRAL", thought: "" };

        if (playerEvents.length > 0) {
            // Grouping Logic: Consolidate rapid-fire events (like item purchases)
            const groupedEvents: any[] = [];
            let currentGroup: any = null;

            playerEvents.forEach((e: any) => {
                const isItemEvent = e.type.startsWith("ITEM_");
                
                if (isItemEvent && currentGroup && currentGroup.type === "ITEM_GROUP" && Math.abs(e.timestamp - currentGroup.timestamp) < 500) {
                    currentGroup.events.push(e);
                } else if (isItemEvent) {
                    if (currentGroup) groupedEvents.push(currentGroup);
                    currentGroup = { type: "ITEM_GROUP", timestamp: e.timestamp, events: [e] };
                } else {
                    if (currentGroup) groupedEvents.push(currentGroup);
                    groupedEvents.push(e);
                    currentGroup = null;
                }
            });
            if (currentGroup) groupedEvents.push(currentGroup);

            groupedEvents.forEach((ge: any) => {
                let eventName = "";
                let context = "";
                let timestamp = 0;
                let isProgression = false;

                if (ge.type === "ITEM_GROUP") {
                    isProgression = true;
                    timestamp = ge.timestamp;
                    const summary: Record<string, string[]> = {};
                    ge.events.forEach((e: any) => {
                        let type = e.type.replace("ITEM_", "");
                        // Explicit differentiation
                        if (type === "SOLD") type = "SELL";
                        if (type === "UNDO") type = "UNDO_ACTION";
                        
                        if (!summary[type]) summary[type] = [];
                        const itemName = itemMap[e.itemId] || `Item_${e.itemId}`;
                        summary[type].push(itemName);
                    });
                    
                    const parts = Object.entries(summary).map(([type, names]) => `${type}: ${names.join(", ")}`);
                    eventName = `ITEMS: ${parts.join(" | ")}`;
                    context = "FOUNTAIN/SHOP";
                } else {
                    timestamp = ge.timestamp;
                    eventName = ge.type.replace(/_/g, " ");
                    if (ge.type === "SKILL_LEVEL_UP" || ge.type === "LEVEL_UP" || ge.type === "WARD_PLACED" || ge.type === "WARD_KILL") {
                        isProgression = true;
                    }
                    
                    if (ge.type === "SKILL_LEVEL_UP") {
                        const slotMap: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
                        const skill = slotMap[ge.skillSlot] || `Slot_${ge.skillSlot}`;
                        eventName = `SKILL LEVEL UP: ${skill}`;
                    } else if (ge.type === "CHAMPION_KILL") {
                        if (ge.killerId === pId) {
                            eventName = `KILL: ${champMap[ge.victimId] || 'CHAMPION'}`;
                        } else if (ge.victimId === pId) {
                            eventName = `DEATH by ${champMap[ge.killerId] || 'UNKNOWN'}`;
                        } else {
                            eventName = `ASSIST: ${champMap[ge.victimId] || 'CHAMPION'}`;
                        }
                    } else if (ge.type === "CHAMPION_SPECIAL_KILL") {
                        if (ge.killType === "KILL_MULTI") {
                            const multiMap: Record<number, string> = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'PENTA KILL' };
                            eventName = multiMap[ge.multiKillLength] || `MULTI KILL (${ge.multiKillLength})`;
                        } else {
                            eventName = ge.killType ? ge.killType.replace("KILL_", "").replace(/_/g, " ") : "SPECIAL KILL";
                        }
                    } else if (ge.type === "ELITE_MONSTER_KILL") {
                        const monster = ge.monsterSubType ? ge.monsterSubType : ge.monsterType;
                        eventName = `KILL: ${monster ? monster.replace(/_/g, " ") : 'MONSTER'}`;
                    } else if (ge.type === "BUILDING_KILL") {
                        const bType = ge.towerType ? `${ge.towerType} TOWER` : ge.buildingType;
                        eventName = `DESTROYED: ${bType ? bType.replace(/_/g, " ") : 'BUILDING'}`;
                    } else if (ge.type === "TURRET_PLATE_DESTROYED") {
                        eventName = `DESTROYED: TURRET PLATE`;
                    }
                    
                    context = ge.position ? getRiftLocation(ge.position.x, ge.position.y) : "GLOBAL";
                }

                const action = "ACTIVE";
                let outcome = "NEUTRAL";
                if (deltaP > 0.005) outcome = "ADVANTAGE";
                else if (deltaP < -0.005) outcome = "DEFICIT";
                
                const zone = getTacticalPhase(t, eventName, deltaP);
                const winProb = (pNext * 100).toFixed(1) + "%";
                
                // Calculate precise time
                const totalSeconds = Math.floor(timestamp / 1000);
                const mm = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
                const ss = (totalSeconds % 60).toString().padStart(2, '0');
                const preciseTime = `${mm}:${ss}`;

                const row = { t, preciseTime, eventName, context, action, outcome, zone, winProb, cognitiveState: cognitive.state, thought: cognitive.thought };
                
                if (isProgression) {
                    progressionRows.push(row);
                } else {
                    telemetryRows.push(row);
                }
                tronStream.push(convertToTRON(row));
            });
        }
    }

    stats.slaughterVelocity = (totalSlaughterVelocity * 100).toFixed(2);
    stats.peakVelocity = (peakVelocity * 100).toFixed(2);
    stats.bleedRate = (bleedRate * 100).toFixed(2);
    stats.catalystScore = (catalystScore * 100).toFixed(2);
    stats.agencyRatio = totalTeamContributionSum > 0 ? ((totalMyContribution / totalTeamContributionSum) * 100).toFixed(1) + "%" : "0.0%";
    stats.damageShare = damageShare;
    stats.tankShare = tankShare;
    stats.towerShare = towerShare;

    tronStream.push(`--------------------------------------------------------------------------------`);
    tronStream.push(`FINAL_SUMMARY | DMG_SHARE: ${stats.damageShare.padEnd(6)} | TANK_SHARE: ${stats.tankShare.padEnd(6)} | TOWER_SHARE: ${stats.towerShare.padEnd(6)} | AGENCY: ${stats.agencyRatio}`);

    const toonMatch = convertToTOON({ match, timeline });

    return { meta, stats, telemetryRows, progressionRows, tronStream, toonMatch, winProbabilityTimeline: winProbs };
};

export const formatForensicReport = (data: any) => {
    const formatRow = (r: any) => `| ${r.preciseTime || r.t + ':00'} | ${r.eventName} | ${r.context} | ${r.action} | ${r.outcome} | ${r.zone} | ${r.winProb} | ${r.cognitiveState || ''} | ${r.thought || ''} |`;
    const formatProgRow = (r: any) => `| ${r.preciseTime || r.t + ':00'} | ${r.eventName} | ${r.context} | ${r.winProb} |`;

    return `# LUNACY PROTOCOL: MATCH FORENSICS

## META
**MATCH ID:** ${data.meta.matchId}
**IDENTITY:** ${data.meta.identity}
**CHAMPION:** ${data.meta.champion} (${data.meta.role})
**ALLIES:** ${data.meta.allies}
**ENEMIES:** ${data.meta.enemies}
**DURATION:** ${data.meta.duration}

## STATS
- **KDA:** ${data.stats.kda}
- **GOLD/MIN:** ${data.stats.goldPerMin}
- **CS/MIN @ 5, 10, 15, 20:** ${data.stats.csMin5}, ${data.stats.csMin10}, ${data.stats.csMin15}, ${data.stats.csMin20}
- **CS/MIN (AVG):** ${data.stats.csMinTotal}
- **TOTAL DAMAGE:** ${data.stats.totalDamage} (${data.stats.damageShare} of team)
- **DAMAGE TAKEN SHARE:** ${data.stats.tankShare}
- **TOWER DAMAGE SHARE:** ${data.stats.towerShare}

## SLAUGHTER METRICS
- **SLAUGHTER VELOCITY (NET):** ${data.stats.slaughterVelocity}
- **CATALYST SCORE (GROSS POSITIVE):** ${data.stats.catalystScore}
- **BLEED RATE (GROSS NEGATIVE):** ${data.stats.bleedRate}
- **PEAK VELOCITY (MAX MINUTE SWING):** ${data.stats.peakVelocity}
- **AGENCY RATIO (TEAM SHARE):** ${data.stats.agencyRatio}

## BUILD & PROGRESSION LOG

| TIME | PROGRESSION EVENT | LOCATION | WIN PROB |
| :---: | :---: | :---: | :---: |
${data.progressionRows.map(formatProgRow).join('\n')}

## PLAYER TELEMETRY (Wide Capture)

| TIME | EVENT | LOCATION | ACTION | OUTCOME | PHASE | WIN PROB | COGNITIVE STATE | THOUGHT |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${data.telemetryRows.map(formatRow).join('\n')}
`;
};


export const generateForensicReport = async (matchId: string, targetPuuid: string, region: string = "americas", audioBuffer?: Buffer, audioMimeType?: string, transcript?: string) => {
    const data = await generateForensicData(matchId, targetPuuid, region, audioBuffer, audioMimeType, transcript);
    const report = formatForensicReport(data);
    return { data, report };
};
