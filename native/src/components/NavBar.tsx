import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Route } from '../app/routes';
import { Section } from '../domain/catalog';
import { colors, fontFamily, noFocusRing } from '../design/theme';
import { Icon, IconButton, IconName } from './Icon';

const appIcon = require('../assets/app-icon.webp');

export type SearchBar = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

function SearchField({
  bar,
  phone = false,
}: {
  bar: SearchBar;
  phone?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.searchField, phone && styles.searchFieldPhone]}>
      <Icon name="search" size={16} color={colors.muted} />
      <TextInput
        {...noFocusRing}
        autoFocus
        accessibilityLabel={bar.placeholder}
        placeholder={bar.placeholder}
        placeholderTextColor={colors.muted}
        value={bar.value}
        onChangeText={bar.onChange}
        style={styles.searchInput}
      />
      {bar.value !== '' && (
        <IconButton
          icon="close"
          label="Clear search"
          size={12}
          onPress={() => bar.onChange('')}
        />
      )}
    </View>
  );
}

export type NavProps = {
  searchBar: SearchBar | null;
  route: Route;
  sections: Section[];
  canGoBack: boolean;
  queueCount: number;
  phone: boolean;
  searchOpen: boolean;
  filtersOpen: boolean;
  filterCount: number;
  onBack: () => void;
  navigate: (route: Route) => void;
  onQueue: () => void;
  onSearch: () => void;
  onFilters: () => void;
};

function SectionTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[styles.tab, hover && styles.tabHover]}
    >
      <Text
        style={[
          styles.tabText,
          (hover || focus) && styles.tabTextLit,
          active && styles.tabTextActive,
        ]}
      >
        {label}
      </Text>
      <View style={[styles.tabLine, active && styles.tabLineActive]} />
    </Pressable>
  );
}

function BottomItem({
  icon,
  label,
  active,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.bottomItem}
    >
      <Icon
        name={icon}
        size={22}
        color={active ? colors.accent : colors.muted}
      />
      {badge !== undefined && badge > 0 && <View style={styles.dot} />}
      <Text style={[styles.bottomLabel, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Top bar on wide windows, bottom section bar on phones. It floats on the background. */
export function NavBar({
  searchBar,
  route,
  sections,
  canGoBack,
  queueCount,
  phone,
  searchOpen,
  filtersOpen,
  filterCount,
  onBack,
  navigate,
  onQueue,
  onSearch,
  onFilters,
}: NavProps): React.JSX.Element {
  const inLibrary = route.name === 'library';
  if (phone) {
    const firstSection = sections[0];
    return (
      <View style={styles.bottomWrap}>
        {searchOpen && searchBar && <SearchField bar={searchBar} phone />}
        <View accessibilityRole="toolbar" style={styles.bottom}>
          <BottomItem
            icon="home"
            label="Home"
            active={route.name === 'home'}
            onPress={() => navigate({ name: 'home' })}
          />
          {inLibrary ? (
            <>
              <BottomItem
                icon="search"
                label="Search"
                active={searchOpen}
                onPress={onSearch}
              />
              <BottomItem
                icon="filter"
                label="Filters"
                active={filtersOpen}
                badge={filterCount}
                onPress={onFilters}
              />
            </>
          ) : (
            firstSection && (
              <BottomItem
                icon="grid"
                label="Library"
                active={false}
                onPress={() =>
                  navigate({ name: 'library', sectionId: firstSection.id })
                }
              />
            )
          )}
          <BottomItem
            icon="queue"
            label="Queue"
            active={route.name === 'queue'}
            badge={queueCount}
            onPress={onQueue}
          />
          <BottomItem
            icon="more"
            label="More"
            active={route.name === 'settings'}
            onPress={() => navigate({ name: 'settings' })}
          />
        </View>
      </View>
    );
  }
  return (
    <View accessibilityRole="toolbar" style={styles.top}>
      <Image
        source={appIcon}
        style={styles.appIcon}
        accessibilityLabel="Anime Manager"
      />
      <IconButton
        icon="back"
        label="Back"
        disabled={!canGoBack}
        onPress={onBack}
      />
      <IconButton
        icon="home"
        label="Home"
        active={route.name === 'home'}
        onPress={() => navigate({ name: 'home' })}
      />
      <View style={styles.tabs}>
        {sections.map(section => (
          <SectionTab
            key={section.id}
            label={section.title}
            active={inLibrary && route.sectionId === section.id}
            onPress={() => navigate({ name: 'library', sectionId: section.id })}
          />
        ))}
      </View>
      {searchOpen && searchBar && inLibrary && <SearchField bar={searchBar} />}
      {inLibrary && (
        <>
          <IconButton
            icon="search"
            label="Search"
            active={searchOpen}
            onPress={onSearch}
          />
          <IconButton
            icon="filter"
            label="Filters"
            active={filtersOpen}
            badge={filterCount}
            onPress={onFilters}
          />
        </>
      )}
      <IconButton
        icon="player"
        label="Custom Player"
        active={route.name === 'custom'}
        onPress={() => navigate({ name: 'custom' })}
      />
      <IconButton
        icon="queue"
        label="Queue"
        active={route.name === 'queue'}
        badge={queueCount}
        onPress={onQueue}
      />
      <IconButton
        icon="settings"
        label="Settings"
        active={route.name === 'settings'}
        onPress={() => navigate({ name: 'settings' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  appIcon: { width: 30, height: 30, marginRight: 8 },
  bottomWrap: { backgroundColor: colors.panel },
  // Above the bottom bar the field is a full-width row of its own height.
  searchFieldPhone: {
    flex: 0,
    maxWidth: undefined,
    minHeight: 48,
    marginHorizontal: 16,
    marginTop: 8,
  },
  searchField: {
    flex: 1,
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: colors.accent,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 0,
    color: colors.text,
    fontFamily,
    fontSize: 15,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    zIndex: 2,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 16,
  },
  tab: { paddingHorizontal: 10, paddingTop: 6, gap: 5 },
  tabText: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    color: colors.muted,
  },
  tabTextLit: { fontFamily, color: colors.text },
  tabHover: { backgroundColor: colors.hover, borderRadius: 6 },
  tabTextActive: { fontFamily, color: colors.accent },
  tabLine: { height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  tabLineActive: { backgroundColor: colors.accent },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 6,
    backgroundColor: colors.panel,
  },
  bottomItem: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bottomLabel: { fontFamily, fontSize: 11, color: colors.muted },
  dot: {
    position: 'absolute',
    top: 8,
    marginLeft: 22,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.chrome,
  },
});
