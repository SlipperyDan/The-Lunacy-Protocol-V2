export const generateTelemetry = () => {
    return {
        meta: {
            timestamp: new Date().toISOString(),
            version: "3.1.0",
            node: "LUNACY_FORENSIC_NODE",
            status: "ACTIVE"
        },
        forensics: {
            matchId: "STANDBY",
            champion: "N/A",
            kda: "0/0/0",
            damageShare: "0%",
            tankShare: "0%",
            towerShare: "0%",
            kp: "0%"
        },
        clinical_log: [],
        tron_stream: ["T+00:00 | [SYSTEM_STANDBY   ] >> PASSIVE -> NEUTRAL | PROB: 50.0%"]
    };
};
