export const IDL = {
  "version": "0.1.0",
  "name": "referral_program",
  "instructions": [
    {
      "name": "storeReferral",
      "accounts": [
        {
          "name": "referrer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "referree",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "referralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "referralCode",
          "type": "string"
        },
        {
          "name": "timestamp",
          "type": "i64"
        },
        {
          "name": "rewardAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "distributeReward",
      "accounts": [
        {
          "name": "referrer",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "rewardTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ReferralAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referrer",
            "type": "publicKey"
          },
          {
            "name": "referree",
            "type": "publicKey"
          },
          {
            "name": "referralCode",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "rewardAmount",
            "type": "u64"
          }
        ]
      }
    }
  ]
}; 