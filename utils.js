import { EXTENSION_NAME, MODULE_NAME } from './conf.js';
import { debounce } from '/scripts/utils.js';
import { chat_metadata, itemizedPrompts, saveChatDebounced } from '/script.js';
import { getContext, saveMetadataDebounced } from '/scripts/extensions.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import { ChatCompletionService, TextCompletionService } from '/scripts/custom-request.js';

export function log() {
    console.log(`[${EXTENSION_NAME}]`, ...arguments);
}

export function error() {
    console.error(`[${EXTENSION_NAME}]`, ...arguments);
    // noinspection JSUnresolvedReference
    toastr.error(Array.from(arguments).join(' '), EXTENSION_NAME);
}

export function toast(message, type="info") {
    // debounce the toast messages
    // noinspection JSUnresolvedReference
    toastr[type](message, EXTENSION_NAME);
}

export function escape_string(text) {
    // escape control characters in the text
    if (!text) return text
    return text.replace(/[\x00-\x1F\x7F]/g, function(match) {
        // Escape control characters
        switch (match) {
            case '\n': return '\\n';
            case '\t': return '\\t';
            case '\r': return '\\r';
            case '\b': return '\\b';
            case '\f': return '\\f';
            default: return '\\x' + match.charCodeAt(0).toString(16).padStart(2, '0');
        }
    });
}

export function unescape_string(text) {
    // given a string with escaped characters, unescape them
    if (!text) return text
    return text.replace(/\\[ntrbf0x][0-9a-f]{2}|\\[ntrbf]/g, function(match) {
        switch (match) {
            case '\\n': return '\n';
            case '\\t': return '\t';
            case '\\r': return '\r';
            case '\\b': return '\b';
            case '\\f': return '\f';
            default: {
                // Handle escaped hexadecimal characters like \\xNN
                const hexMatch = match.match(/\\x([0-9a-f]{2})/i);
                if (hexMatch) {
                    return String.fromCharCode(parseInt(hexMatch[1], 16));
                }
                return match; // Return as is if no match
            }
        }
    });
}

export const toast_debounced = debounce(toast, 500);

export function check_objects_different(obj_1, obj_2) {
    // check whether two objects are different by checking each key, recursively
    // if both are objects, recurse on each element of obj_1
    // The "instanceof" method is true for Objects, Arrays, and Sets.
    if (obj_1 instanceof Object && obj_2 instanceof Object) {
        let keys = Object.keys(obj_1).concat(Object.keys(obj_2))
        for (let key of keys) {
            if (check_objects_different(obj_1[key], obj_2[key])) {
                return true  // different
            }
        }
        return false  // not different
    } else {  // not both objects - check equality directly
        return obj_1 !== obj_2  // return if different
    }
}

export function get_current_character_identifier() {
    // uniquely identify the current character
    // You have to use the character's avatar image path to uniquely identify them
    let context = SillyTavern.getContext();

    // If a group, we can use the group ID to uniquely identify it
    if (context.groupId) {
        return context.groupId
    }

    // Otherwise get the avatar image path of the current character
    let index = context.characterId;
    if (!index) {  // not a character
        return null;
    }

    return context.characters[index].avatar;
}

export function get_chat_metadata(key, copy=false) {
    // Get a key from chat metadata
    let value = chat_metadata[MODULE_NAME]?.[key]
    if (copy) {  // needed when retrieving objects
        return structuredClone(value)
    } else {
        return value
    }
}

export function set_chat_metadata(key, value, copy=false) {
    // Set a key and value in chat metadata (persists with branches)
    if (copy) {
        value = structuredClone(value);
    }
    if (!chat_metadata[MODULE_NAME]) chat_metadata[MODULE_NAME] = {};
    chat_metadata[MODULE_NAME][key] = value;
    saveMetadataDebounced();
}

export function clean_string_for_html(text) {
    // clean a given string for use in a div title.
    return text.replace(/["&'<>]/g, function(match) {
        switch (match) {
            case '"': return "&quot;";
            case "&": return "&amp;";
            case "'": return "&apos;";
            case "<": return "&lt;";
            case ">": return "&gt;";
        }
    })
}

export function set_data(message, key, value) {
    // store information on the message object
    if (!message.extra) {
        message.extra = {};
    }
    if (!message.extra[MODULE_NAME]) {
        message.extra[MODULE_NAME] = {};
    }

    message.extra[MODULE_NAME][key] = value;

    // Also save on the current swipe info if present
    let swipe_index = message.swipe_id
    if (swipe_index && message.swipe_info?.[swipe_index]) {
        if (!message.swipe_info[swipe_index].extra) {
            message.swipe_info[swipe_index].extra = {};
        }
        message.swipe_info[swipe_index].extra[MODULE_NAME] = structuredClone(message.extra[MODULE_NAME])
    }

    saveChatDebounced();
}

export function get_data(message, key) {
    // get information from the message object
    return message?.extra?.[MODULE_NAME]?.[key];
}

export function count_tokens(text, padding = 0) {
    // count the number of tokens in a text
    let ctx = getContext();
    return ctx.getTokenCount(text, padding);
}

export function get_message_prompts(index) {
    // Return an object containing prompt information for a given message index
    // We can do this by iterating through the itemizedPrompts array and trying to match the message ID
    for (let i = 0; i < itemizedPrompts.length; i++) {
        let itemized_prompt = itemizedPrompts[i]
        if (itemized_prompt.mesId === index) {
            return itemized_prompt  // found one with a matching ID
        }
    }
}

export function as_message(text) {
    return {
        content: text
    };
}

export function get_message_div(index) {
    // given a message index, get the div element for that message
    // it will have an attribute "mesid" that is the message index
    // noinspection JSUnresolvedReference
    let div = $(`div[mesid="${index}"]`);
    if (div.length === 0) {
        return null;
    }
    return div;
}

export function get_preset(profile, context) {
    const selectedApiMap = context.ConnectionManagerRequestService.validateProfile(profile);
    let presetManager;
    let preset = null;
    switch (selectedApiMap.selected) {
        case 'openai': {
            presetManager = getPresetManager(ChatCompletionService.TYPE);
        } break;
        case 'textgenerationwebui': {
            presetManager = getPresetManager(TextCompletionService.TYPE);
        } break;
    }
    if (presetManager) {
        if (profile.preset) {
            preset = presetManager.getCompletionPresetByName(profile.preset);
        } else {
            preset = presetManager.getSelectedPreset();
        }
        return presetManager.getPresetSettings(preset);
    }
    return null;
}

export const global_references = {
    check_connection_profiles_active: null,
    update_connection_profile_dropdown: null,
    get_connection_profiles: null,
}
