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
    },
    adjustDeckCounts(data, cardId, delta, cardLimit, maxDeckSize) {
      if (!data || typeof data !== 'object' || !cardId) return {ok:false,reason:'invalid_input'};
      const step = Number(delta);
      if (step !== 1 && step !== -1) return {ok:false,reason:'invalid_delta'};
      const source = data.deckCounts && typeof data.deckCounts === 'object' && !Array.isArray(data.deckCounts)
        ? data.deckCounts : {};
      const counts = Object.assign({}, source);
      const current = Number(counts[cardId] || 0);
      if (!Number.isInteger(current) || current < 0) return {ok:false,reason:'invalid_count'};
      const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
      if (!Number.isFinite(total) || total < 0) return {ok:false,reason:'invalid_total'};
      const next = current + step;
      if (next < 0) return {ok:false,reason:'below_zero'};
      if (step > 0 && total >= Number(maxDeckSize)) return {ok:false,reason:'deck_full'};
      const limit = Number(cardLimit);
      if (step > 0 && next > (Number.isInteger(limit) ? Math.max(0, limit) : 4)) {
        return {ok:false,reason:'card_limit'};
      }
      if (next === 0) delete counts[cardId];
      else counts[cardId] = next;
      data.deckCounts = counts;
      return {ok:true,counts:data.deckCounts,total:total + step,next};
    }
  });

  root.FM = root.FM || {};
  root.FM.DeckState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
