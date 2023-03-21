import React, { Component } from 'react';
import ShowEmote from './components/showEmote';

class Emotes extends Component {
  render() {
    return (
      <div>
        <ShowEmote emote_data={this.props.emoteData}/>
      </div>
    );
  }
}
 
export default Emotes;