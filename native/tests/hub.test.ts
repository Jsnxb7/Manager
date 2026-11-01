import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Workspace } from '../src/app/useWorkspace';
import { Hub } from '../src/screens/Hub';
import { Button, Field } from '../src/components/controls';
import { emptyCatalog, emptySettings, Catalog } from '../src/domain/catalog';
describe('Hub interactions in a mocked React Native host', () => {
  it('opens the selected library and creates a section through its dialog', async () => {
    const catalog = emptyCatalog();
    const navigate = jest.fn();
    const error = jest.fn();
    const workspace = {
      catalog,
      settings: emptySettings(),
      busy: false,
      setError: error,
      run: async (job: () => Promise<void>) => {
        await job();
      },
      mutate: async (change: (value: Catalog) => void) => {
        change(catalog);
      },
    } as unknown as Workspace;
    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(React.createElement(Hub, { workspace, navigate }));
    });
    const button = (label: string) =>
      tree!.root
        .findAllByType(Button)
        .find(node => node.props.label === label)!;
    const tile = (label: string) =>
      tree!.root.findAll(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )[0]!;
    await act(async () => {
      tile('Browse Anime').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith({
      name: 'library',
      sectionId: 'anime',
    });
    await act(async () => {
      tile('Add section').props.onPress();
    });
    await act(async () => {
      tree!.root.findByType(Field).props.onChange('Movies');
    });
    await act(async () => {
      button('Create section').props.onPress();
    });
    expect(catalog.sections.some(s => s.id === 'movies')).toBe(true);
    expect(error).not.toHaveBeenCalled();
    await act(async () => {
      tree!.unmount();
    });
  });
});
