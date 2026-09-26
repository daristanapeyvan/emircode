/**
 * Open floating menus (Select). While one is open, Escape belongs to it: dialogs underneath must
 * not close on the same key press.
 */
let openMenus = 0;

export const menuOpened = () => {
  openMenus++;
};

export const menuClosed = () => {
  openMenus = Math.max(0, openMenus - 1);
};

export const isMenuOpen = () => openMenus > 0;
