// Discord's own limits, in one place: whatever has to stay under one of them reads it here, so a change in what Discord accepts is one edit.
export const DISCORD_MESSAGE_LIMIT = 2000;
export const EMBED_DESCRIPTION_LIMIT = 4096;
export const EMBED_FIELD_LIMIT = 1024;
export const MENU_OPTION_CHARS = 100;
export const MENU_PLACEHOLDER_CHARS = 150;
export const MENU_OPTIONS = 25;
// Five rows of one menu each is all a message holds.
export const MENUS_PER_MESSAGE = 5;
export const CHOICES = 25;
export const CHOICE_CHARS = 100;
export const BUTTON_LABEL_CHARS = 80;
export const MODAL_TEXT_CHARS = 45;
export const CUSTOM_ID_CHARS = 100;
export const MAX_CATEGORY_NAME = 100;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
// A message whose whole request is over 25 MiB is refused, however little each file in it weighs.
export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
