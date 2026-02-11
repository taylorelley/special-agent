type StateDirEnvSnapshot = {
  specialAgentStateDir: string | undefined;
};

export function snapshotStateDirEnv(): StateDirEnvSnapshot {
  return {
    specialAgentStateDir: process.env.SPECIAL_AGENT_STATE_DIR,
  };
}

export function restoreStateDirEnv(snapshot: StateDirEnvSnapshot): void {
  if (snapshot.specialAgentStateDir === undefined) {
    delete process.env.SPECIAL_AGENT_STATE_DIR;
  } else {
    process.env.SPECIAL_AGENT_STATE_DIR = snapshot.specialAgentStateDir;
  }
}

export function setStateDirEnv(stateDir: string): void {
  process.env.SPECIAL_AGENT_STATE_DIR = stateDir;
}
