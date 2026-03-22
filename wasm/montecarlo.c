#include <stdint.h>

extern unsigned char __heap_base;

static uintptr_t heap_offset = 0;
static uint32_t rng_state = 0x9E3779B9u;

static void reset_heap_base(void) {
    if (heap_offset == 0) {
        heap_offset = (uintptr_t)&__heap_base;
    }
}

int alloc(int bytes) {
    reset_heap_base();

    if (bytes <= 0) {
        return 0;
    }

    uintptr_t ptr = heap_offset;
    heap_offset = (ptr + (uintptr_t)bytes + 7u) & ~(uintptr_t)7u;
    return (int)ptr;
}

void reset_alloc(void) {
    heap_offset = (uintptr_t)&__heap_base;
}

void seed_rng(uint32_t seed) {
    rng_state = seed ? seed : 0x9E3779B9u;
}

static uint32_t next_u32(void) {
    uint32_t x = rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng_state = x;
    return x;
}

static int random_index(int limit) {
    if (limit <= 1) {
        return 0;
    }

    return (int)(next_u32() % (uint32_t)limit);
}

static int get_best_hand_fast(const int *cards, int length) {
    uint8_t rank_counts[13] = { 0 };
    uint8_t suit_counts[4] = { 0 };
    uint8_t suit_ranks[4][8] = { { 0 } };
    uint8_t suit_lengths[4] = { 0 };

    for (int i = 0; i < length; i++) {
        int card = cards[i];
        int rank = card >> 2;
        int suit = card & 3;
        rank_counts[rank]++;
        suit_ranks[suit][suit_lengths[suit]++] = (uint8_t)rank;
        suit_counts[suit]++;
    }

    int flush_suit = -1;
    for (int suit = 0; suit < 4; suit++) {
        if (suit_counts[suit] >= 5) {
            flush_suit = suit;
            break;
        }
    }

    if (flush_suit != -1) {
        int flush_bits = 0;
        int flush_len = suit_lengths[flush_suit];

        for (int i = 0; i < flush_len; i++) {
            flush_bits |= (1 << suit_ranks[flush_suit][i]);
        }

        int straight_flush_high = -1;
        for (int high = 12; high >= 4; high--) {
            int pattern = 0x1F << (high - 4);
            if ((flush_bits & pattern) == pattern) {
                straight_flush_high = high;
                break;
            }
        }

        if (straight_flush_high == -1 && (flush_bits & 0x100F) == 0x100F) {
            straight_flush_high = 3;
        }

        if (straight_flush_high != -1) {
            if (straight_flush_high == 12) {
                return (9 << 20) | (12 << 16);
            }

            return (8 << 20) | (straight_flush_high << 16);
        }
    }

    int quad_rank = -1;
    int trip1 = -1;
    int trip2 = -1;
    int pair1 = -1;
    int pair2 = -1;

    for (int rank = 12; rank >= 0; rank--) {
        int count = rank_counts[rank];
        if (count == 4) {
            quad_rank = rank;
        } else if (count == 3) {
            if (trip1 == -1) {
                trip1 = rank;
            } else {
                trip2 = rank;
            }
        } else if (count == 2) {
            if (pair1 == -1) {
                pair1 = rank;
            } else if (pair2 == -1) {
                pair2 = rank;
            }
        }
    }

    if (quad_rank != -1) {
        int kicker = -1;
        for (int rank = 12; rank >= 0; rank--) {
            if (rank != quad_rank && rank_counts[rank] > 0) {
                kicker = rank;
                break;
            }
        }

        return (7 << 20) | (quad_rank << 16) | (kicker << 12);
    }

    if (trip1 != -1) {
        int pair_for_full_house = -1;
        if (trip2 != -1) {
            pair_for_full_house = trip2;
        } else if (pair1 != -1) {
            pair_for_full_house = pair1;
        }

        if (pair_for_full_house != -1) {
            return (6 << 20) | (trip1 << 16) | (pair_for_full_house << 12);
        }
    }

    if (flush_suit != -1) {
        int flush_len = suit_lengths[flush_suit];
        uint8_t *flush_cards = suit_ranks[flush_suit];

        for (int i = 0; i < flush_len - 1; i++) {
            for (int j = i + 1; j < flush_len; j++) {
                if (flush_cards[j] > flush_cards[i]) {
                    uint8_t temp = flush_cards[i];
                    flush_cards[i] = flush_cards[j];
                    flush_cards[j] = temp;
                }
            }
        }

        return (5 << 20)
            | (flush_cards[0] << 16)
            | (flush_cards[1] << 12)
            | (flush_cards[2] << 8)
            | (flush_cards[3] << 4)
            | flush_cards[4];
    }

    int rank_bits = 0;
    for (int rank = 0; rank < 13; rank++) {
        if (rank_counts[rank] > 0) {
            rank_bits |= (1 << rank);
        }
    }

    int straight_high = -1;
    for (int high = 12; high >= 4; high--) {
        int pattern = 0x1F << (high - 4);
        if ((rank_bits & pattern) == pattern) {
            straight_high = high;
            break;
        }
    }

    if (straight_high == -1 && (rank_bits & 0x100F) == 0x100F) {
        straight_high = 3;
    }

    if (straight_high != -1) {
        return (4 << 20) | (straight_high << 16);
    }

    if (trip1 != -1) {
        int kicker0 = -1;
        int kicker1 = -1;

        for (int rank = 12; rank >= 0; rank--) {
            if (rank != trip1 && rank_counts[rank] > 0) {
                if (kicker0 == -1) {
                    kicker0 = rank;
                } else if (kicker1 == -1) {
                    kicker1 = rank;
                    break;
                }
            }
        }

        return (3 << 20) | (trip1 << 16) | (kicker0 << 12) | (kicker1 << 8);
    }

    if (pair1 != -1 && pair2 != -1) {
        int kicker = -1;
        for (int rank = 12; rank >= 0; rank--) {
            if (rank != pair1 && rank != pair2 && rank_counts[rank] > 0) {
                kicker = rank;
                break;
            }
        }

        return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8);
    }

    if (pair1 != -1) {
        int kicker0 = -1;
        int kicker1 = -1;
        int kicker2 = -1;

        for (int rank = 12; rank >= 0; rank--) {
            if (rank != pair1 && rank_counts[rank] > 0) {
                if (kicker0 == -1) {
                    kicker0 = rank;
                } else if (kicker1 == -1) {
                    kicker1 = rank;
                } else if (kicker2 == -1) {
                    kicker2 = rank;
                    break;
                }
            }
        }

        return (1 << 20)
            | (pair1 << 16)
            | (kicker0 << 12)
            | (kicker1 << 8)
            | (kicker2 << 4);
    }

    int high0 = -1;
    int high1 = -1;
    int high2 = -1;
    int high3 = -1;
    int high4 = -1;

    for (int rank = 12; rank >= 0; rank--) {
        if (rank_counts[rank] > 0) {
            if (high0 == -1) {
                high0 = rank;
            } else if (high1 == -1) {
                high1 = rank;
            } else if (high2 == -1) {
                high2 = rank;
            } else if (high3 == -1) {
                high3 = rank;
            } else if (high4 == -1) {
                high4 = rank;
                break;
            }
        }
    }

    return (high0 << 16) | (high1 << 12) | (high2 << 8) | (high3 << 4) | high4;
}

int run_simulations_random(
    int hand0,
    int hand1,
    int community_ptr,
    int community_len,
    int num_opponents,
    int num_simulations,
    int output_ptr
) {
    if (num_opponents < 1 || num_opponents > 8 || num_simulations < 1 || community_len < 0 || community_len > 5) {
        return 0;
    }

    int *community_cards = (int *)((uintptr_t)community_ptr);
    int *output = (int *)((uintptr_t)output_ptr);
    int known[52] = { 0 };
    int remaining_deck[52];
    int deck[52];
    int full_community[5];
    int my_full_hand[7];
    int opp_full_hand[7];
    int hand_distribution[10] = { 0 };
    int win_units = 0;
    int tie_units = 0;
    int loss_units = 0;
    int deck_size = 0;
    int community_needed = 5 - community_len;
    int cards_needed = community_needed + (num_opponents * 2);

    known[hand0] = 1;
    known[hand1] = 1;

    my_full_hand[0] = hand0;
    my_full_hand[1] = hand1;

    for (int i = 0; i < community_len; i++) {
        int card = community_cards[i];
        known[card] = 1;
        full_community[i] = card;
        my_full_hand[2 + i] = card;
    }

    for (int card = 0; card < 52; card++) {
        if (!known[card]) {
            remaining_deck[deck_size++] = card;
        }
    }

    for (int simulation = 0; simulation < num_simulations; simulation++) {
        for (int i = 0; i < deck_size; i++) {
            deck[i] = remaining_deck[i];
        }

        int shuffle_end = cards_needed < deck_size ? cards_needed : deck_size;
        for (int i = 0; i < shuffle_end; i++) {
            int swap_index = i + random_index(deck_size - i);
            int temp = deck[i];
            deck[i] = deck[swap_index];
            deck[swap_index] = temp;
        }

        int draw_index = 0;

        for (int i = 0; i < community_needed; i++) {
            int card = deck[draw_index++];
            full_community[community_len + i] = card;
            my_full_hand[2 + community_len + i] = card;
        }

        int my_eval = get_best_hand_fast(my_full_hand, 7);
        int hand_rank = my_eval >> 20;
        hand_distribution[hand_rank]++;

        int my_result = 0;
        int tie_count = 0;

        for (int opponent = 0; opponent < num_opponents; opponent++) {
            opp_full_hand[0] = deck[draw_index++];
            opp_full_hand[1] = deck[draw_index++];

            for (int i = 0; i < 5; i++) {
                opp_full_hand[2 + i] = full_community[i];
            }

            int opp_eval = get_best_hand_fast(opp_full_hand, 7);

            if (my_eval < opp_eval) {
                my_result = 2;
                break;
            }

            if (my_eval == opp_eval) {
                tie_count++;
                if (my_result == 0) {
                    my_result = 1;
                }
            }
        }

        if (my_result == 0) {
            win_units += 1000;
        } else if (my_result == 1) {
            int share = 1000 / (tie_count + 1);
            win_units += share;
            tie_units += (1000 - share);
        } else {
            loss_units += 1000;
        }
    }

    output[0] = win_units;
    output[1] = tie_units;
    output[2] = loss_units;
    output[3] = num_simulations;

    for (int rank = 0; rank < 10; rank++) {
        output[4 + rank] = hand_distribution[rank];
    }

    return 1;
}
