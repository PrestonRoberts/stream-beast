import React, { Component } from "react";

class ShowEmote extends Component {
    divStyle = {
        style: "position:relative",
        width: 1920,
        height: 1080,
    };

    render() { 
        return (
            <div style={this.divStyle}>
                {this.generateEmoteImage()}
            </div>
        );
    }

    generateEmoteImage() {
        let emote_data = this.props.emote_data;
        let emoteLink = this.getEmoteLink(emote_data);
        console.log(emote_data);
        
        if (emoteLink === "") {
            return ""
        } else {
            let emoteImg = <img src={emoteLink} style={this.getEmoteStyle(emote_data)} alt='emote'/>
            return emoteImg;
        }
    }

    getEmoteLink (emote_data) {
        return emote_data["emote"] ? emote_data["emote"]["link"] : "";
    }

    getEmoteStyle (emote_data) {
        let emoteStyle =  {
            height: 100,
            position: "absolute",
            animation: "temporaryVisability 4s forwards",
            opacity: 0,
            right: emote_data["x"] ? emote_data["x"] : 0,
            top: emote_data["y"] ? emote_data["y"] : 0
        }
        return emoteStyle;
    }
}
 
export default ShowEmote;