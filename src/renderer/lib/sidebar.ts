import { BarChart3, BookOpen, Clock, FolderTree, Heart, Home, Image as ImageIcon, Library, Music2, Tv, type LucideIcon } from 'lucide-react';
import type { Route } from '../state/router';

export type SidebarId = 'home' | 'videos' | 'music' | 'comics' | 'books' | 'photos' | 'browse' | 'favorites' | 'history' | 'stats';

export interface SidebarDef {
  id: SidebarId;
  label: string;
  icon: LucideIcon;
  route: Route;
  group: 'library' | 'collections';
}

export const SIDEBAR: Record<SidebarId, SidebarDef> = {
  home: { id: 'home', label: 'Home', icon: Home, route: { name: 'home' }, group: 'library' },
  videos: { id: 'videos', label: 'Videos', icon: Tv, route: { name: 'videos' }, group: 'library' },
  music: { id: 'music', label: 'Music', icon: Music2, route: { name: 'music' }, group: 'library' },
  comics: { id: 'comics', label: 'Manga & Comics', icon: Library, route: { name: 'comics' }, group: 'library' },
  books: { id: 'books', label: 'Books', icon: BookOpen, route: { name: 'books' }, group: 'library' },
  photos: { id: 'photos', label: 'Photos', icon: ImageIcon, route: { name: 'photos' }, group: 'library' },
  browse: { id: 'browse', label: 'Browse Folders', icon: FolderTree, route: { name: 'browse', path: null }, group: 'library' },
  favorites: { id: 'favorites', label: 'Favourites', icon: Heart, route: { name: 'favorites' }, group: 'collections' },
  history: { id: 'history', label: 'History', icon: Clock, route: { name: 'history' }, group: 'collections' },
  stats: { id: 'stats', label: 'Statistics', icon: BarChart3, route: { name: 'stats' }, group: 'collections' }
};
