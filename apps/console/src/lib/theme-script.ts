/**
 * Runs inline in <head> before the first paint (app/layout.tsx): puts `.dark` or `.light` on <html> from the saved
 * choice ("rms.theme": light | dark | system) or the OS, so the page never flashes the wrong theme.
 * Plain ES5 with no imports — it runs before any bundle. Its own file so the server layout doesn't pull in React hooks.
 */
export const THEME_KEY = "rms.theme";
export const DARK_MQ = "(prefers-color-scheme: dark)";

export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("${DARK_MQ}").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
