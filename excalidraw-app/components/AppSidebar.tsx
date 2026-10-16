import { DefaultSidebar, Sidebar } from "@excalidraw/excalidraw";
import { MagicIcon } from "@excalidraw/excalidraw/components/icons";

import { CloudIconsPanel, CLOUD_ICONS_TAB } from "./CloudIcons/CloudIconsPanel";

import "./AppSidebar.scss";

export const AppSidebar = () => {
  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger
          tab={CLOUD_ICONS_TAB}
          title="Icons: AWS, Azure, Google Cloud and brands"
        >
          {MagicIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab={CLOUD_ICONS_TAB}>
        <CloudIconsPanel />
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};
