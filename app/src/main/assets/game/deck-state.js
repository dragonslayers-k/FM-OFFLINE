(function (root) {
  'use strict';

  const api = Object.freeze({
    currentDeckCounts(data, cardCount, createStarterDeck) {
      if (!Number(cardCount)) return {};
      if (!data.deckCounts || typeof data.deckCounts !== 'object' || Array.isArray(data.deckCounts)) {
        if (typeof createStarterDeck !== 'function') throw new TypeError('createStarterDeck must be a function');
        data.deckCounts = createStarterDeck();
      }
      return data.deckCounts;
    },
    clearDeckCounts(data) {
      data.deckCounts = {};
      return data.deckCounts;
    }
  });

  root.FM = root.FM || {};
  root.FM.DeckState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
