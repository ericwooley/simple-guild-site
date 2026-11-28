import test from 'node:test';
import assert from 'node:assert/strict';
import { rollupDonationTransactions } from '../src/server/activityRollup.mjs';

const fmt = (c) => `${Number(c)}c`;

test('rollupDonationTransactions merges items for the same account within 1 hour and sums duplicate items', () => {
  const txs = [
    {
      id: 'tx1',
      groupKey: 'account:acc1',
      txType: 'deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Roldand Redwater',
      actorCharacterId: 'char-primary',
      itemId: 1001,
      suffixId: 10,
      itemName: 'Willow Bracers of Spirit',
      quantity: 1,
      totalVendorCopper: 3000,
      occurredAt: '2026-11-28T15:14:00.000Z',
    },
    {
      id: 'tx2',
      groupKey: 'account:acc1',
      txType: 'deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Roldand Redwater',
      actorCharacterId: 'char-primary',
      itemId: 1001,
      suffixId: 10,
      itemName: 'Willow Bracers of Spirit',
      quantity: 1,
      totalVendorCopper: 3000,
      occurredAt: '2026-11-28T15:14:00.000Z',
    },
    {
      id: 'tx3',
      groupKey: 'account:acc1',
      txType: 'deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Roldand Redwater',
      actorCharacterId: 'char-primary',
      itemId: 1002,
      suffixId: 0,
      itemName: 'Simple Britches of the Owl',
      quantity: 1,
      totalVendorCopper: 229,
      occurredAt: '2026-11-28T14:30:00.000Z',
    },
    // Over 1 hour earlier -> separate entry
    {
      id: 'tx4',
      groupKey: 'account:acc1',
      txType: 'deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Roldand Redwater',
      actorCharacterId: 'char-primary',
      itemId: 1003,
      suffixId: 0,
      itemName: 'Linen Cloth',
      quantity: 20,
      totalVendorCopper: 400,
      occurredAt: '2026-11-28T13:00:00.000Z',
    },
  ];

  const rolled = rollupDonationTransactions(txs, { formatCopper: fmt });
  assert.equal(rolled.length, 2);

  const recent = rolled[0];
  assert.equal(recent.txType, 'donation-rollup');
  assert.equal(recent.actorName, 'Roldand Redwater');
  assert.equal(recent.actorCharacterId, 'char-primary');
  assert.equal(recent.rolledCount, 3);
  assert.equal(recent.quantity, 3);
  assert.equal(recent.totalVendorCopper, 6229);
  assert.equal(recent.items.length, 2);
  assert.equal(recent.items[0].itemName, 'Willow Bracers of Spirit');
  assert.equal(recent.items[0].quantity, 2);
  assert.equal(recent.items[1].itemName, 'Simple Britches of the Owl');
  assert.equal(recent.items[1].quantity, 1);

  const older = rolled[1];
  assert.equal(older.txType, 'deposit');
  assert.equal(older.itemName, 'Linen Cloth');
  assert.equal(older.quantity, 20);
});

test('rollupDonationTransactions handles mixed gold + items in one window', () => {
  const txs = [
    {
      id: 'tx-gold',
      groupKey: 'account:acc2',
      txType: 'money-deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Omaroon',
      actorCharacterId: 'char-main',
      moneyCopper: 15000,
      totalVendorCopper: 15000,
      occurredAt: '2026-11-28T15:10:00.000Z',
    },
    {
      id: 'tx-item',
      groupKey: 'account:acc2',
      txType: 'deposit',
      bankName: 'Linda Helpinghand',
      actorName: 'Omaroon',
      actorCharacterId: 'char-main',
      itemId: 2001,
      itemName: 'Silk Cloth',
      quantity: 10,
      totalVendorCopper: 1500,
      occurredAt: '2026-11-28T15:05:00.000Z',
    },
  ];

  const rolled = rollupDonationTransactions(txs, { formatCopper: fmt });
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].txType, 'donation-rollup');
  assert.equal(rolled[0].moneyCopper, 15000);
  assert.equal(rolled[0].quantity, 10);
  assert.equal(rolled[0].totalVendorCopper, 16500);
  assert.equal(rolled[0].items.length, 1);
});
