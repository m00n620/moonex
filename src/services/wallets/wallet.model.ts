import { Schema, model, type InferSchemaType } from 'mongoose';

const walletSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    network: {
      type: String,
      enum: ['ethereum', 'tron'],
      required: true,
      index: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    encryptedPrivateKey: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

walletSchema.index({ network: 1, address: 1 }, { unique: true });

export type Wallet = InferSchemaType<typeof walletSchema>;

export const WalletModel = model('Wallet', walletSchema);
