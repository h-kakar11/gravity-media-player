import { create } from 'zustand';

/** Which smart playlist the rule editor is showing: `null` = closed, `id: null` = creating a new one. */
interface SmartEditorState {
  editing: { id: number | null } | null;
}

export const useSmartEditor = create<SmartEditorState>(() => ({ editing: null }));

export const openSmartEditor = (id: number | null = null) => useSmartEditor.setState({ editing: { id } });
export const closeSmartEditor = () => useSmartEditor.setState({ editing: null });
