// models/Entry.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');
const { v4: uuidv4 } = require('uuid');

const Entry = sequelize.define('Entry', {
  id: {
    type: DataTypes.UUID,
    defaultValue: () => uuidv4(),
    primaryKey: true,
  },

  submittedAt: { type: DataTypes.DATE, allowNull: false },

  // athlete1
  athlete1_name:  { type: DataTypes.STRING },
  athlete1_phone: { type: DataTypes.STRING },
  athlete1_email: { type: DataTypes.STRING },
  athlete1_city:  { type: DataTypes.STRING },
  athlete1_kit:   { type: DataTypes.STRING },

  // athlete2
  athlete2_name:  { type: DataTypes.STRING },
  athlete2_phone: { type: DataTypes.STRING },
  athlete2_email: { type: DataTypes.STRING },
  athlete2_city:  { type: DataTypes.STRING },
  athlete2_kit:   { type: DataTypes.STRING },

  // dupla
  duo_name:      { type: DataTypes.STRING },
  duo_category:  { type: DataTypes.STRING, allowNull: false },
  duo_instagram: { type: DataTypes.STRING },

  // demais
  consent:         { type: DataTypes.BOOLEAN, defaultValue: false },
  uniforms:        { type: DataTypes.STRING },
  paymentProof:    { type: DataTypes.STRING },
  paymentProofUrl: { type: DataTypes.STRING },
  status:          { type: DataTypes.STRING, defaultValue: 'pending_review' },

  // (opcional) campos de validação
  validation_ok:         { type: DataTypes.BOOLEAN },
  validation_score:      { type: DataTypes.INTEGER },
  validation_mime:       { type: DataTypes.STRING },
  validation_textSample: { type: DataTypes.TEXT },
}, {
  tableName: 'entries',
  indexes: [
    { fields: ['submittedAt'] },
    { fields: ['duo_category'] },
    { fields: ['status'] },
  ],
});

module.exports = { Entry };
