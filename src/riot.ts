const RIOT_API_KEY = process.env.RIOT_API_KEY;

const headers = {
    "X-Riot-Token": RIOT_API_KEY || "",
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchRiotAPI(url: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        const res = await fetch(url, { headers });
        
        if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After");
            const waitTime = retryAfter ? (parseInt(retryAfter) * 1000) : (Math.pow(2, i) * 1000 + Math.random() * 1000);
            console.warn(`Riot API Rate Limit (429) for ${url}. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
            await delay(waitTime);
            continue;
        }

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Riot API Error (${res.status}) for ${url}: ${errorText}`);
            throw new Error(`Riot API Error: ${res.status}`);
        }
        return res.json();
    }
    throw new Error(`Riot API Error: 429 (Max retries exceeded)`);
}

export const getAccount = async (gameName: string, tagLine: string, region: string = "americas") => {
    if (!RIOT_API_KEY) throw new Error("RIOT_API_KEY_MISSING");
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return fetchRiotAPI(url);
};

export const getMatchIds = async (puuid: string, region: string = "americas", start: number = 0, count: number = 10) => {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
    return fetchRiotAPI(url);
};

export const getMatchDetails = async (matchId: string, region: string = "americas") => {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return fetchRiotAPI(url);
};

export const getMatchTimeline = async (matchId: string, region: string = "americas") => {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`;
    return fetchRiotAPI(url);
};

export const getRecentMatches = async (gameName: string, tagLine: string, region: string = "americas", start: number = 0, count: number = 10) => {
    const account = await getAccount(gameName, tagLine, region);
    const puuid = account.puuid;
    
    const matchIds = await getMatchIds(puuid, region, start, count);
    
    const matches = [];
    for (const id of matchIds) {
        try {
            const match = await getMatchDetails(id, region);
            if (match) matches.push(match);
        } catch (e: any) {
            console.error(`Error fetching details for match ${id}`, e);
            if (e.message.includes("429")) break;
        }
        await delay(250);
    }
    
    return matches;
};
