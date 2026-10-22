// The card owns its hit area and presentation; pages keep their existing actions.
Component({
  options: { multipleSlots: true },
  properties: {
    title: String, tag: String, subject: String, meta: String, preview: String, pronunciation: String,
    status: String, completed: Boolean, hasActions: Boolean
  },
  methods: {
    open() { this.triggerEvent('open'); },
    stopActionTap() {}
  }
});
