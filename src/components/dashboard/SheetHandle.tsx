/**
 * Grab-handle shown at the top of bottom-sheet modals on phones.
 * Purely visual — tells the user the panel slides up from the bottom.
 * Hidden from `sm:` upwards where modals are centred dialogs instead.
 */
export default function SheetHandle() {
  return <div aria-hidden className="mx-auto -mt-1 mb-4 h-1.5 w-10 rounded-full bg-gray-200 sm:hidden" />;
}
