export const BOOT_STAGE_OPENING_SHELL = 'opening-shell'
export const BOOT_STAGE_PREPARING_HOME = 'preparing-home-snapshot'
export const BOOT_STAGE_HYDRATING_ANIME = 'hydrating-anime-shelves'
export const BOOT_STAGE_HYDRATING_MANGA = 'hydrating-manga-shelves'
export const BOOT_STAGE_FINAL_REVEAL = 'final-reveal'

export const BOOT_CATCHPHRASE = 'setting the room for tonight'

const BOOT_STAGE_LABELS = {
  [BOOT_STAGE_OPENING_SHELL]: 'opening shell',
  [BOOT_STAGE_PREPARING_HOME]: 'preparing home snapshot',
  [BOOT_STAGE_HYDRATING_ANIME]: 'hydrating anime shelves',
  [BOOT_STAGE_HYDRATING_MANGA]: 'hydrating manga shelves',
  [BOOT_STAGE_FINAL_REVEAL]: 'final reveal',
}

export function getBootStageLabel(stage) {
  return BOOT_STAGE_LABELS[stage] ?? BOOT_STAGE_LABELS[BOOT_STAGE_OPENING_SHELL]
}
