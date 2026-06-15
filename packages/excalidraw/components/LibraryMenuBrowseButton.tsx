import { useApp, useExcalidrawSetAppState } from "./App";
import { fileOpen } from "../data/filesystem";
import { t } from "../i18n";

import type { ExcalidrawProps, UIAppState } from "../types";

const LibraryMenuBrowseButton = ({
  theme,
  id,
  libraryReturnUrl,
}: {
  libraryReturnUrl: ExcalidrawProps["libraryReturnUrl"];
  theme: UIAppState["theme"];
  id: string;
}) => {
  const { library } = useApp();
  const setAppState = useExcalidrawSetAppState();

  const onLibraryImport = async () => {
    try {
      await library.updateLibrary({
        libraryItems: fileOpen({
          description: "Excalidraw library files",
          // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
          // gets resolved. Else, iOS users cannot open `.excalidraw` files.
          /*
            extensions: [".json", ".excalidrawlib"],
            */
        }),
        merge: true,
        openLibraryMenu: true,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        console.warn(error);
        return;
      }
      setAppState({ errorMessage: t("errors.importLibraryError") });
    }
  };

  return (
    <button
      type="button"
      className="library-menu-browse-button"
      onClick={onLibraryImport}
      style={{
        border: "none",
        cursor: "pointer",
      }}
    >
      {t("buttons.load")}
    </button>
  );
};

export default LibraryMenuBrowseButton;
